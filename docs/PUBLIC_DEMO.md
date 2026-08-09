# Public demo

The project includes a credential-free static build of the complete design
studio. It lets visitors try every theme and control, export configuration, and
open or copy a responsive demo Browser Source without Twitch credentials or an
OpenStreamAlert server. The fixture's native emote image is fetched from
Twitch's public `static-cdn.jtvnw.net` image host; no Twitch API or OAuth endpoint
is contacted.

The demo deliberately cannot connect an account, persist settings, or display
live chat. Its copied overlay URL is a self-contained visual snapshot whose
configuration is encoded in the URL. It contains no account identifier, OAuth
credential, or server-side overlay key.

## GitHub Pages deployment

The public demo is deployed at
[ericflo.github.io/openstreamalert](https://ericflo.github.io/openstreamalert/).
The `Public demo` workflow builds the studio with `VITE_PUBLIC_DEMO=1` and a
repository-relative asset base, then deploys it through GitHub Pages:

1. Push to `main`, or run the **Public demo** workflow manually.
2. Verify the URL reported by the workflow at desktop and mobile widths.
3. Open a copied demo URL directly and confirm that the transparent overlay
   renders after a hard refresh.

The workflow copies `index.html` to `404.html` so GitHub Pages can serve the
client-routed `/overlay/demo` path. All workflow actions are pinned to immutable
commits. No Twitch credentials or repository secrets are used.

## Test the static build locally

```bash
VITE_PUBLIC_DEMO=1 VITE_BASE_PATH=/openstreamalert/ npm run build
cp dist/client/index.html dist/client/404.html
npx vite preview --outDir dist/client --base /openstreamalert/
```

Visit the preview URL under `/openstreamalert/`. The production self-hosted app
remains the supported path for real Twitch chat; the public demo is a product
tour and OBS visual test only.
