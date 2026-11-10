import type { Metadata } from "next";
import { Card } from "../../components/ui/Card.tsx";

export const metadata: Metadata = { title: "Not available in your region" };

export default function RestrictedPage() {
  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Not available in your region</h1>
      <p>
        Stock Tokens are not available to US persons or in restricted jurisdictions, so Flatpack cannot be used from your location.
      </p>
      <Card title="What you can still do">
        <p>
          You can still read the public data feed at{" "}
          <a href="/api/baskets">/api/baskets</a>. Those pages stay open for everyone.
        </p>
      </Card>
      <p className="muted" style={{ marginTop: 16 }}>
        If you believe you reached this page by mistake, for example through a VPN, disconnect it and reload.
      </p>
    </div>
  );
}
