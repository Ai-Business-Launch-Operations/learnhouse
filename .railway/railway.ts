// Railway Infrastructure as Code for this fork. See RAILWAY.md at the repo root
// for the deploy runbook; this file is applied with `railway config apply`.
import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  redis,
  service,
  volume,
} from "railway/iac";

// Hostname the app is served on. Railway fills RAILWAY_PUBLIC_DOMAIN in once a
// domain is generated (`railway domain --port 80`). To move to a custom domain,
// set this to the bare hostname and add `{ domain: HOST, port: 80 }` to the
// service's `domains`. The port matters: the SDK defaults custom domains to 8080.
const HOST = "${{RAILWAY_PUBLIC_DOMAIN}}";
const ORIGIN = `https://${HOST}`;

const ORG_NAME = "AI Business Launch";
const ORG_SLUG = "default";

const DATABASE = "Postgres";
const CACHE = "Redis";

export default defineRailway(() => {
  // Railway's Postgres image ships pgvector, which the course chatbot (RAG) needs.
  const db = postgres(DATABASE);
  const cache = redis(CACHE);

  // Uploaded course content when LEARNHOUSE_CONTENT_DELIVERY_TYPE=filesystem.
  const content = volume("learnhouse-content");

  const app = service("learnhouse", {
    source: github("Ai-Business-Launch-Operations/learnhouse", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      // Everything the root Dockerfile copies; docs, CLI and CI changes skip a deploy.
      watchPatterns: [
        "Dockerfile",
        ".dockerignore",
        ".bun-version",
        "docker/**",
        "apps/api/**",
        "apps/web/**",
        "apps/collab/**",
      ],
    },
    // The image is all-in-one: nginx on :80 fronts Next.js (:8000), the API
    // (:9000) and the collab server (:4000). Railway routes and health-checks
    // $PORT, so PORT=80 below points it at nginx. Next.js also reads PORT, so
    // the start command hands it back the 8000 that nginx proxies to.
    start: 'sh -c "export PORT=8000 && exec sh /app/start.sh"',
    healthcheck: "/api/v1/health",
    // First boot creates the schema and the admin before the API answers.
    healthcheckTimeout: 300,
    // One replica: uploads live on a single-attach volume and the API runs its
    // schedulers in-process.
    replicas: 1,
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    volumeMounts: {
      "/app/api/content": content,
    },
    env: {
      PORT: "80",
      HOSTNAME: "0.0.0.0",

      LEARNHOUSE_ENV: "production",
      LEARNHOUSE_DEVELOPMENT_MODE: "false",
      LEARNHOUSE_TENANCY: "single",

      LEARNHOUSE_DOMAIN: HOST,
      LEARNHOUSE_FRONTEND_DOMAIN: HOST,
      // No LEARNHOUSE_COOKIE_DOMAIN: single tenancy issues host-only cookies,
      // and the API logs a warning on every config load when it is set.
      LEARNHOUSE_SSL: "true",
      LEARNHOUSE_ALLOWED_ORIGINS: ORIGIN,

      NEXT_PUBLIC_LEARNHOUSE_DOMAIN: HOST,
      NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN: HOST,
      NEXT_PUBLIC_LEARNHOUSE_HTTPS: "true",
      NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL: `${ORIGIN}/`,
      NEXT_PUBLIC_LEARNHOUSE_API_URL: `${ORIGIN}/api/v1/`,
      NEXT_PUBLIC_COLLAB_URL: `wss://${HOST}/collab`,
      NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG: ORG_SLUG,
      NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG: "false",

      LEARNHOUSE_SQL_CONNECTION_STRING: db.env.DATABASE_URL,
      LEARNHOUSE_REDIS_CONNECTION_STRING: cache.env.REDIS_URL,
      // The collab server uses ioredis, which only resolves IPv4 unless told
      // otherwise; family=0 lets it reach Railway's private network over IPv6.
      LEARNHOUSE_REDIS_URL: `\${{${CACHE}.REDIS_URL}}?family=0`,
      LEARNHOUSE_CONTENT_DELIVERY_TYPE: "filesystem",

      LEARNHOUSE_PORT: "9000",
      // Collab calls the API directly; its default (:8000) is Next.js.
      LEARNHOUSE_API_URL: "http://localhost:9000",
      COLLAB_TRUST_PROXY: "true",

      LEARNHOUSE_INITIAL_ORG_NAME: ORG_NAME,
      LEARNHOUSE_INITIAL_ORG_SLUG: ORG_SLUG,

      LEARNHOUSE_IS_AI_ENABLED: "false",

      // Secrets stay out of this public repo. .railway/set-secrets.sh generates
      // and stores them once; preserve() keeps apply from touching them.
      LEARNHOUSE_AUTH_JWT_SECRET_KEY: preserve(),
      COLLAB_INTERNAL_KEY: preserve(),
      LEARNHOUSE_INITIAL_ADMIN_EMAIL: preserve(),
      LEARNHOUSE_INITIAL_ADMIN_PASSWORD: preserve(),
    },
  });

  return project("learnhouse", {
    resources: [app, db, cache, content],
  });
});
