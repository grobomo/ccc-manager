# Spec: 015 Environment Variable Config Interpolation

Config values should support ${VAR} and ${VAR:-default} syntax for K8s/Docker deployments
where secrets come from environment variables, not plaintext in YAML files.

Example:
```yaml
notifiers:
  teams:
    type: webhook
    url: ${TEAMS_WEBHOOK_URL}
    secret: ${HMAC_SECRET:-default-dev-secret}
```
