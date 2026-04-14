/**
 * Serves files from [assets] (./public). Replaces any default "Hello World"
 * worker that may exist on the Cloudflare dashboard.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
