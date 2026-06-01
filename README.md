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

## Render Deploy

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
