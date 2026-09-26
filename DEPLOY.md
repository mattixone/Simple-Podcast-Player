# Putting Couchcast online

This takes about 10 minutes, once. It's free: Couchcast fits comfortably inside Cloudflare's free plan.

At the end you'll have your own address, like `https://couchcast.your-name.workers.dev`. It works on the couch PC, your laptop and your iPhone, and your progress follows you between them.

## Before you start

- A free Cloudflare account ([sign up](https://dash.cloudflare.com/sign-up)).
- This code on the repository's main branch. Cloudflare builds from main by default, so merge this branch first.

## Option A: from the Cloudflare website (no command line)

1. In the Cloudflare dashboard, go to **Workers & Pages** and choose **Create**.
2. Choose **Import a repository**. Connect your GitHub account when asked, then pick **simple-podcast-player**.
3. Keep the project name **couchcast**. Leave the build command empty and the deploy command as `npx wrangler deploy`. Choose **Deploy**.
4. When it finishes, open the new **couchcast** Worker and go to **Settings → Variables and Secrets**. Add a variable:
   - Type: **Secret**
   - Name: `APP_PASSWORD`
   - Value: the password you want to use
5. Choose **Deploy** so the password takes effect.
6. Open the `workers.dev` address shown on the Worker's page and sign in with your password.

From now on, every change pushed to main updates the app automatically.

## Option B: from a terminal

```sh
npm install
npx wrangler login                 # opens a browser to connect your Cloudflare account
npx wrangler secret put APP_PASSWORD
npm run deploy
```

## On your iPhone

1. Open your Couchcast address in **Safari** and sign in.
2. Tap **Share → Add to Home Screen**.

It then opens full screen with its own icon. The lock screen shows the artwork and play/pause and skip controls. Use the phone's own buttons for volume, because iPhones don't let web apps change it.

## Good to know

- **Changing the password:** change the `APP_PASSWORD` secret. Every device is signed out and needs the new one.
- **Searching:** search uses Apple's public podcast directory. Most podcasts are in it, including ones you'd find in Apple Podcasts.
- **What's stored:** only your subscriptions, where you're up to in each episode, and which episode is current. They live in your own Cloudflare account. Nothing else is kept.
- **Trying it on your own computer:** copy `.dev.vars.example` to `.dev.vars`, set a password in it, then run `npm run dev` and open `http://localhost:8787`.
