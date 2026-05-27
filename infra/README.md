# Deployment

SRE Sentinel ships as two services:

- **orchestrator** → Cloud Run (Docker image built from `infra/orchestrator/Dockerfile`)
- **dashboard** → Firebase Hosting (static Vite build, with `/api/**` rewritten to the Cloud Run service)

The dashboard and the orchestrator share an origin in production thanks to the Firebase Hosting rewrite, so the session cookie and the SSE stream just work — no CORS, no cross-origin gymnastics.

## One-time setup

You need an active GCP project with billing enabled and Firebase initialized against the same project.

### 1. Enable APIs

```powershell
gcloud services enable `
  run.googleapis.com `
  artifactregistry.googleapis.com `
  cloudbuild.googleapis.com `
  secretmanager.googleapis.com `
  iam.googleapis.com
```

### 2. Create the Artifact Registry repo

```powershell
gcloud artifacts repositories create sre-sentinel `
  --repository-format=docker `
  --location=us-central1 `
  --description="SRE Sentinel container images"
```

### 3. Create the runtime service account

The orchestrator runs as this identity. It only needs Secret Manager access (and, eventually, the IAM bindings needed to actually restart a Cloud Run "victim" service in REAL remediation mode).

```powershell
$PROJECT_ID = gcloud config get-value project
gcloud iam service-accounts create sre-sentinel-orchestrator `
  --display-name="SRE Sentinel orchestrator runtime"

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:sre-sentinel-orchestrator@$PROJECT_ID.iam.gserviceaccount.com" `
  --role="roles/secretmanager.secretAccessor"
```

### 4. Push secrets into Secret Manager

These map 1:1 to the `secretKeyRef` blocks in `service.yaml`. Generate the session secret and webhook token the same way you did locally (32+ bytes of crypto-random hex).

```powershell
# Use --data-file=- to pipe in without leaving secrets in shell history.
"YOUR_GEMINI_API_KEY"                    | gcloud secrets create gemini-api-key --data-file=-
"YOUR_64_HEX_SESSION_SECRET"             | gcloud secrets create dashboard-session-secret --data-file=-
"YOUR_DEMO_PASSWORD"                     | gcloud secrets create dashboard-demo-password --data-file=-
"YOUR_AT_LEAST_16_CHAR_WEBHOOK_TOKEN"    | gcloud secrets create webhook-token --data-file=-
```

If/when the Dynatrace trial is active, also create `dynatrace-env-url` and `dynatrace-api-token`, then uncomment the corresponding env blocks in `service.yaml`.

### 5. Allow Cloud Build to deploy on your behalf

The Cloud Build service account already has Cloud Run admin in most projects, but it also needs to *use* the runtime service account:

```powershell
$CLOUD_BUILD_SA = "$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')@cloudbuild.gserviceaccount.com"

gcloud iam service-accounts add-iam-policy-binding `
  "sre-sentinel-orchestrator@$PROJECT_ID.iam.gserviceaccount.com" `
  --member="serviceAccount:$CLOUD_BUILD_SA" `
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$CLOUD_BUILD_SA" `
  --role="roles/run.developer"
```

### 6. Initialize Firebase

In `infra/dashboard/.firebaserc`, replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with the same GCP project id (Firebase reuses GCP project ids). Then:

```powershell
cd infra/dashboard
firebase login          # one-time
firebase use --add      # confirm the project
cd ../..
```

## Deploy: orchestrator

```powershell
# Build, push, and roll out a new Cloud Run revision in one shot.
gcloud builds submit `
  --config=infra/orchestrator/cloudbuild.yaml `
  --substitutions=_REGION=us-central1,_REPO=sre-sentinel
```

The first deploy may take ~3 minutes (image build + push + new service creation). Subsequent deploys are ~90 seconds since cached layers cover the dependency install.

After it lands, grab the URL:

```powershell
gcloud run services describe sre-sentinel-orchestrator `
  --region=us-central1 `
  --format='value(status.url)'
```

Smoke-test it:

```powershell
$URL = gcloud run services describe sre-sentinel-orchestrator --region=us-central1 --format='value(status.url)'
curl "$URL/healthz"
```

## Deploy: dashboard

The dashboard's `/api/**` requests are rewritten to the Cloud Run service via `firebase.json`. That means the dashboard build does NOT need to know the Cloud Run URL — Firebase Hosting handles routing.

```powershell
# Build the static bundle from the workspace root.
npm run build --workspace @sre-sentinel/dashboard

# Deploy from the firebase config dir.
cd infra/dashboard
firebase deploy --only hosting
cd ../..
```

Firebase prints the live URL on success (typically `https://<project-id>.web.app` and `https://<project-id>.firebaseapp.com`).

## Wiring a real Dynatrace webhook

Once the trial is active and you've created the `dynatrace-env-url`/`dynatrace-api-token` secrets and uncommented those env blocks in `service.yaml`, configure a Dynatrace custom webhook integration pointing at:

```
https://<your-firebase-host>/api/webhooks/dynatrace
```

with an HTTP header:

```
Authorization: Bearer <the same value you put into the webhook-token secret>
```

The webhook payload can be the default Dynatrace ProblemNotification template — the orchestrator accepts both PascalCase (`ProblemID`, `ProblemTitle`, …) and camelCase shapes.

## Cost & rollback

- `service.yaml` pins `maxScale: 1` and `minScale: 0`, so the orchestrator scales to zero when idle. Cold start adds ~1.5s to the first webhook of a quiet period.
- Roll back to a previous revision:

```powershell
gcloud run services update-traffic sre-sentinel-orchestrator `
  --region=us-central1 `
  --to-revisions=<revision-name>=100
```

- Tear down the demo entirely:

```powershell
gcloud run services delete sre-sentinel-orchestrator --region=us-central1
firebase hosting:disable
```
