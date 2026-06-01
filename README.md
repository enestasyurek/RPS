# Camera Rock Paper Scissors MVP

Two-player online rock paper scissors with room codes, Socket.IO realtime state, and on-device MediaPipe hand detection.

## Quick Start

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- Server: http://localhost:4000

Open the web app on two devices or two browser windows, create a room on one side, join with the room code on the other, allow the camera, then press ready on both players.

If Vite chooses a different port, use the URL printed by `npm run dev`. For a second physical device, open the printed Network URL and keep both devices on the same Wi-Fi. Some mobile browsers block camera access on plain LAN HTTP, so use an HTTPS tunnel or staging deploy for full phone-camera testing.

## Production Notes

The camera API requires a secure context in production, so deploy behind HTTPS. This MVP stores rooms in server memory; a server restart clears active rooms. Set `CLIENT_ORIGIN` to the production web origin instead of `*` when deploying.

## Free Oracle VPS Deploy Without Buying a Domain

You can publish this on an Oracle Free Tier VM without buying a domain by using a free wildcard DNS hostname from `nip.io`.

Why this is needed:

- Phone camera access needs HTTPS.
- A bare public IP over HTTP will not reliably expose `navigator.mediaDevices.getUserMedia`.
- `nip.io` maps a hostname to your public IP for free, and Caddy can issue a normal HTTPS certificate for that hostname.

Example:

- Oracle public IP: `129.159.12.34`
- Free hostname: `rps-129-159-12-34.nip.io`
- Public game URL: `https://rps-129-159-12-34.nip.io`

### 1. Open Oracle Network Ports

In Oracle Cloud Console, open ingress rules for the subnet or Network Security Group attached to the VM:

- TCP `80` from `0.0.0.0/0`
- TCP `443` from `0.0.0.0/0`
- TCP `22` only from your own IP if possible

Also allow HTTP/HTTPS on the VM firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 2. Install Runtime Packages

SSH into the Oracle VM, then install Node 22, Git, and Caddy:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git dnsutils ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Check versions:

```bash
node -v
npm -v
caddy version
```

### 3. Upload or Clone the App

Use `/opt/rps-camera-mvp` as the production app directory:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin rps
sudo mkdir -p /opt/rps-camera-mvp
sudo chown -R "$USER":"$USER" /opt/rps-camera-mvp

git clone <your-repo-url> /opt/rps-camera-mvp
cd /opt/rps-camera-mvp
npm ci
npm run build
```

If the repo is already cloned elsewhere, copy it to `/opt/rps-camera-mvp` instead.

### 4. Create the Free Hostname

Get your public IP:

```bash
curl -4 ifconfig.me
```

Convert dots to dashes and put `rps-` in front.

Example:

```text
129.159.12.34 -> rps-129-159-12-34.nip.io
```

Confirm DNS resolves back to the VM:

```bash
dig +short rps-129-159-12-34.nip.io
```

### 5. Configure App Environment

Create `/etc/rps-camera-mvp.env`:

```bash
sudo tee /etc/rps-camera-mvp.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
CLIENT_ORIGIN=https://rps-129-159-12-34.nip.io
EOF
```

Replace `rps-129-159-12-34.nip.io` with your own `nip.io` hostname.

### 6. Run the App with systemd

Install the service file:

```bash
sudo cp /opt/rps-camera-mvp/deploy/rps-camera-mvp.service /etc/systemd/system/rps-camera-mvp.service
sudo systemctl daemon-reload
sudo systemctl enable --now rps-camera-mvp
sudo systemctl status rps-camera-mvp
```

The Node app should now be listening only on `127.0.0.1:4000`.

### 7. Configure Caddy HTTPS Reverse Proxy

Create `/etc/caddy/Caddyfile`:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
rps-129-159-12-34.nip.io {
  encode zstd gzip
  reverse_proxy 127.0.0.1:4000
}
EOF
```

Replace the hostname with your own `nip.io` hostname.

Reload Caddy:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

### 8. Smoke Test

From your laptop:

```bash
curl https://rps-129-159-12-34.nip.io/health
```

Expected:

```json
{"ok":true}
```

Then open this URL on two phones or a phone and computer:

```text
https://rps-129-159-12-34.nip.io
```

Create a room on one device and join the same room on the other device.

### Useful VPS Commands

```bash
sudo journalctl -u rps-camera-mvp -f
sudo journalctl -u caddy -f
sudo systemctl restart rps-camera-mvp
sudo systemctl reload caddy
```

### Updating the App

```bash
cd /opt/rps-camera-mvp
git pull
npm ci
npm run build
sudo systemctl restart rps-camera-mvp
```

### Notes

- Keep the Oracle VM instance count to one; rooms are stored in server memory.
- If the Oracle public IP changes, your `nip.io` hostname must change too.
- For a stable URL, reserve a public IP in Oracle or buy a domain later.
- Do not expose port `4000` publicly. Public traffic should enter through Caddy on `443`.

## Optional Render Deploy

This app is ready for a single Render Web Service. The Node server serves both the React build and Socket.IO from the same HTTPS origin.

1. Push the repository to GitHub.
2. In Render, create a new Web Service from the repo, or use the included `render.yaml` blueprint.
3. Use these settings if configuring manually:
   - Build Command: `npm ci && npm run build`
   - Start Command: `npm start`
   - Root Directory: repository root
   - Instance count: `1`
4. Set environment variables:
   - `NODE_ENV=production`
   - `CLIENT_ORIGIN=https://<your-render-service>.onrender.com`
   - `PORT` is provided by Render
5. Open `https://<your-render-service>.onrender.com` on two phones or a phone and computer, then join the same room.

For the first blueprint deploy, Render may ask for `CLIENT_ORIGIN` before the service URL exists. Use the generated `onrender.com` URL after the first deploy, then redeploy. Leaving it blank also works for the MVP because the web app and Socket.IO share one origin, but locking it later is cleaner.
