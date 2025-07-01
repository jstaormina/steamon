const express = require('express');
const { Client } = require('ssh2');
const axios = require('axios');
const app = express();
const path = require('path');
const port = 3000;
const https = require('https');
const net = require('net');

// Config
const sshConfig = {
  host: process.env.WIN11_VM_IP,
  port: 22,
  username: process.env.WIN11_VM_USER,
  password: process.env.WIN11_VM_PASSWORD,
};
const proxmoxHost = process.env.PVE_HOST;
const username = process.env.PVE_USER;
const password = process.env.PVE_PASSWORD;

const NODE = process.env.PVE_NODE_NAME;
const TEMPLATE_VMID = process.env.WIN11_TEMPLATE_VMID;
const NEW_VMID = process.env.WIN11_VM_VMID;
const NEW_VM_NAME = process.env.WIN11_VM_NAME;

// Helper to run SSH command
function runSSHCommand(command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(err);

        stream.on('close', () => {
          conn.end();
          stderr ? reject(stderr) : resolve(stdout.trim());
        });

        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
      });
    }).on('error', reject).connect(sshConfig);
  });
}

// Reuse agent to ignore self-signed certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getProxmoxAuth() {
  try {
    const response = await axios.post(
      `https://${proxmoxHost}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );
    const data = response.data.data;
    return {
      ticket: data.ticket,
      csrfToken: data.CSRFPreventionToken,
      cookie: `PVEAuthCookie=${data.ticket}`,
    };
  } catch (err) {
    console.error('Failed to authenticate with Proxmox:', err.response?.data || err.message);
    throw new Error('Proxmox authentication failed');
  }
}

app.get('/api/vm-status', async (req, res) => {
  try {
    const { cookie } = await getProxmoxAuth();
    const vmStatusRes = await axios.get(
      `https://${proxmoxHost}:8006/api2/json/nodes/pve/qemu/${NEW_VMID}/status/current`,
      {
        headers: { Cookie: cookie },
        httpsAgent,
      }
    );
    res.json({ status: vmStatusRes.data.data.status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Proxmox VM status', detail: err.response?.data || err.message });
  }
});

// Endpoint 2: Check if Windows is reachable (just use ping)
app.get('/api/windows-status', async (req, res) => {
  try {
    const output = await runSSHCommand('pwsh -Command "Write-Output Online"');
    res.json({ reachable: output.includes('Online') });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reach Windows VM over SSH', detail: err });
  }
});

// Endpoint 3: Check dummy display driver
app.get('/api/display-driver-status', async (req, res) => {
  try {
    const psCommand = `Get-WmiObject Win32_PnPSignedDriver | Where-Object { $_.DeviceName -like 'Virtual Display Driver' } | Select-Object DeviceName, DriverVersion | ConvertTo-Json`;
    const output = await runSSHCommand(`pwsh -Command "${psCommand}"`);
    res.json({ displayDriverLoaded: output.includes('Virtual Display Driver') });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check display driver', detail: err.toString() });
  }
});

// Endpoint 4: Check if Steam is running
app.get('/api/steam-status', async (req, res) => {
  try {
    const psCommand = `Get-Process -Name steam -ErrorAction SilentlyContinue | Select-Object Name, Id | ConvertTo-Json`;
    const output = await runSSHCommand(`pwsh -Command "${psCommand}"`);
    const parsed = output ? JSON.parse(output) : null;
    res.json({ steamRunning: !!parsed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check Steam process', detail: err.toString() });
  }
});

// Endpoint 5: Check Steam Link status (port 27036 open)
app.get('/api/steam-link-status', async (req, res) => {
  const host = sshConfig.host;
  const port = 27036;
  const socket = new net.Socket();
  let isOpen = false;
  let responded = false;

  socket.setTimeout(2000);

  socket.on('connect', () => {
    isOpen = true;
    responded = true;
    socket.destroy();
    res.json({ steamLinkPortOpen: true });
  });

  socket.on('timeout', () => {
    if (!responded) {
      responded = true;
      socket.destroy();
      res.json({ steamLinkPortOpen: false });
    }
  });

  socket.on('error', () => {
    if (!responded) {
      responded = true;
      res.json({ steamLinkPortOpen: false });
    }
  });

  socket.connect(port, host);
});

async function callPveApi(method, url, body) {
  const { cookie, csrfToken } = await getProxmoxAuth();
  return await axios({
    method,
    url,
    data: body,
    headers: {
      Cookie: cookie,
      CSRFPreventionToken: csrfToken
    },
    httpsAgent,
  });
}

function waitForTaskCompletion(taskId) {
  return new Promise((resolve, reject) => {
    const checkStatus = async () => {
      try {
        response = await callPveApi('get', `https://${proxmoxHost}:8006/api2/json/nodes/${NODE}/tasks/${encodeURIComponent(taskId)}/status`)
        const status = response.data?.data?.status;
        if (status === 'stopped' || status === 'failed') {
          resolve(status);
        } else {
          setTimeout(checkStatus, 2000); // Check again after 2 seconds
        }
      } catch (err) {
        reject(err);
      }
    };
    checkStatus();
  });
}

async function runPveTask(method, url, body) {
  try {
    const res = await callPveApi(method, url, body);
    await waitForTaskCompletion(res.data?.data);
  } catch (err) {
    console.error(`Error running Proxmox task: ${err.response?.data || err.message}`);
    throw err;
  }
}

app.post('/api/clone-vm', async (req, res) => {
  try {
    // stop the VM if it's running
    await runPveTask('post', `https://${proxmoxHost}:8006/api2/json/nodes/${NODE}/qemu/${NEW_VMID}/status/stop`);
    // delete the VM if it exists
    try {
      await runPveTask('delete', `https://${proxmoxHost}:8006/api2/json/nodes/${NODE}/qemu/${NEW_VMID}`);
    } catch (err) {
      if (err.response?.statusText !== `Configuration file 'nodes/pve/qemu-server/${NEW_VMID}.conf' does not exist`) {
        throw err
      }
      console.debug(`${NEW_VMID} doesnt exist.  continue to clone.`)
    }
    // Clone the template VM
    await runPveTask('post', `https://${proxmoxHost}:8006/api2/json/nodes/${NODE}/qemu/${TEMPLATE_VMID}/clone`, new URLSearchParams({
      newid: NEW_VMID.toString(),
      name: NEW_VM_NAME,
      full: '0'
    }));
    // Start the new VM
    await runPveTask('post', `https://${proxmoxHost}:8006/api2/json/nodes/${NODE}/qemu/${NEW_VMID}/status/start`);

    res.json({
      success: true,
      vmid: NEW_VMID,
      name: NEW_VM_NAME
    });
  } catch (err) {
    console.error('Error cloning VM:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to clone VM' });
  }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: serve index.html for any non-API route
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Steam monitor API running at http://localhost:${port}`);
  });
}

module.exports = app;
