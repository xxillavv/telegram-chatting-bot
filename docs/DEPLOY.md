# Deployment

Two free options:

- **[Render + MongoDB Atlas](#render--mongodb-atlas-easiest)**: no server to manage, everything is set up in the browser, and every push to `main` redeploys automatically. The easiest way.
- **[Oracle Cloud Always Free](#oracle-cloud-always-free)**: your own VM with Docker Compose. More work, but more resources and no sleeping.

> [!WARNING]
> Whichever you pick, stop the bot on your own machine first. Two instances polling with the same token make Telegram return `409 Conflict`.

---

# Render + MongoDB Atlas (easiest)

Render's free web service sleeps after 15 minutes without incoming HTTP requests. The bot exposes `GET /health`, and a free uptime monitor pings it every 5 minutes so it never falls asleep. Free Render gives 750 instance hours a month, enough to run one service 24/7.

## 1. Database: MongoDB Atlas

1. Sign up at [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) and create a **free M0** cluster (any provider, a region close to you).
2. **Database Access** → add a user with a password.
3. **Network Access** → add `0.0.0.0/0` (Render has no fixed IP).
4. **Connect → Drivers** → copy the connection string and put your password in it:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`

## 2. Bot: Render

1. Sign up at [render.com](https://render.com) with your GitHub account.
2. **New → Blueprint** → pick the `telegram-chatting-bot` repo. Render reads [`render.yaml`](../render.yaml) and creates a free Docker web service.
3. It asks for three secrets:
   - `TG_API_TOKEN`: bot token from BotFather
   - `LLM_API_KEY`: Groq key
   - `MONGO_URL`: the Atlas connection string from step 1
4. **Apply**. The first build takes a few minutes; then send the bot `/start` in Telegram.

Every push to `main` triggers a redeploy automatically.

## 3. Keep it awake: UptimeRobot

1. Sign up at [uptimerobot.com](https://uptimerobot.com) (free).
2. **New monitor** → type **HTTP(s)**, URL `https://<your-service>.onrender.com/health`, interval **5 minutes**.

Without this, the bot falls asleep after 15 minutes and stops answering.

---

# Oracle Cloud Always Free

The bot runs as a long-lived process: it long-polls Telegram and keeps auto-send timers in memory, so it needs an always-on machine rather than serverless or a sleeping free tier. Oracle Cloud's Always Free tier gives you an ARM VM (up to 4 OCPU / 24 GB RAM) at no cost, which is more than enough for the bot and MongoDB.

Everything runs with Docker Compose: the `bot` service and `mongo` on the same VM. No inbound ports are needed besides SSH.

## 1. Create an Oracle Cloud account

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). A card is required for verification; Always Free resources are never charged.
2. Choose your **home region** carefully: it can't be changed, and Always Free ARM instances only run there. Pick one close to you (e.g. Frankfurt, Amsterdam, Stockholm).

> [!IMPORTANT]
> Always Free instances that stay mostly idle for 7 days can be reclaimed by Oracle, and a chat bot is mostly idle. To avoid that, upgrade the account to **Pay As You Go** (Billing → Upgrade). Always Free resources stay free after the upgrade; set a budget alert of $1 under Billing → Budgets for peace of mind.

## 2. Create the VM

**Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Image | Canonical Ubuntu 24.04 |
| Shape | Ampere → `VM.Standard.A1.Flex`, 1 OCPU, 6 GB RAM |
| Networking | Default VCN with a public IPv4 address |
| SSH keys | Upload your public key (`~/.ssh/id_ed25519.pub`) |

If you get **"Out of capacity"**, try another availability domain or retry later; ARM capacity in popular regions frees up over time.

Note the instance's public IP once it's running.

## 3. Install Docker

```bash
ssh ubuntu@<PUBLIC_IP>

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit   # log back in so the group change applies
```

## 4. Get the code and configure it

```bash
ssh ubuntu@<PUBLIC_IP>

git clone https://github.com/xxillavv/telegram-chatting-bot.git
cd telegram-chatting-bot
cp .env.example .env
nano .env
```

Fill in `.env` the same way as for local development, and add one line so Compose also starts the bot:

```env
COMPOSE_PROFILES=bot
```

`MONGO_URL` is overridden inside Compose to point at the `mongo` container, so you can leave it as is.

## 5. Start it

```bash
docker compose up -d --build
docker compose logs -f bot
```

Send the bot `/start` in Telegram to check it answers. Both containers restart automatically after crashes and VM reboots.

## Updating

```bash
cd ~/telegram-chatting-bot
git pull
docker compose up -d --build
```

## Useful commands

```bash
docker compose ps                 # container status
docker compose logs -f bot        # live bot logs
docker compose restart bot        # restart the bot only
docker image prune -f             # clean up old images after updates
```

## Backups

Sessions live in the `mongo-data` Docker volume. To dump them to a file:

```bash
docker compose exec mongo mongodump --archive --gzip > backup-$(date +%F).gz
```

Restore with:

```bash
docker compose exec -T mongo mongorestore --archive --gzip --drop < backup-YYYY-MM-DD.gz
```
