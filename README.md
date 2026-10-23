# Printful API demo with Polotno

A t-shirt customizer built with Polotno SDK that sends the design to the Printful API and shows the mockups Printful renders.

> **You need a Polotno API key to run this.** The code in this repo is MIT, but it runs on [Polotno SDK](https://polotno.com), which is commercial. Get a trial key in your [Polotno dashboard](https://polotno.com/cabinet) to try it (trial keys show a "Powered by Polotno" credit); shipping it in a product needs a [paid Polotno license](https://polotno.com/sdk/pricing).

Try it live: [polotno.com/sdk/product/integrations/printful](https://polotno.com/sdk/product/integrations/printful)

## How it works

1. The server reads the tee's print area from Printful, so the dashed box on the shirt matches the real print file.
2. The customer designs inside that box. Polotno exports one transparent PNG per side at Printful's pixel size.
3. The server creates a task with Printful's mockup generator and waits for the result.
4. Nothing is ordered. The response includes the request you would send to make it real.

## Run it

You need Node 20+, pnpm, a Polotno API key (a trial key from [polotno.com/cabinet](https://polotno.com/cabinet) works for trying it) and Printful API credentials.

```bash
cd server
cp .env.example .env   # add your Printful credentials
node --env-file=.env server.mjs
```

```bash
cd web
cp .env.example .env   # add your Polotno key
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The credentials stay on the server.

Printful downloads the print file from this server, so to run it locally expose the server with a tunnel (for example `cloudflared tunnel --url http://localhost:8787`) and set `PUBLIC_URL` to the tunnel address.

## Where things are

- `web/src/scene.js`: the shirt photo, the print-window overlay, and the export clipped to the print area
- `web/src/provider.js`, `web/src/provider-panel.jsx`: the Printful step and the result dialog
- `server/server.mjs`: the Printful API calls

## More providers

The same pattern for other print APIs: [polotno-project on GitHub](https://github.com/polotno-project?q=demo) (Printful, Printify, Teemill, Fourthwall, Spreadconnect, Scalable Press, Lulu, Peecho, Gelato, Prodigi).

## License

The code in this repository is MIT. Polotno SDK itself is not: it needs a Polotno API key, and production use needs a [paid license](https://polotno.com/sdk/pricing).
