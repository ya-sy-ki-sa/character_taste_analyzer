import { documentText } from "../../worker/platform/provenance/document";

export default {
  async fetch(request: Request) {
    return new Response(await documentText(await request.text()));
  },
};
