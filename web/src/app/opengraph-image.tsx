import { ImageResponse } from "next/og";

export const alt = "MezoLend: lend and borrow MUSD against bitcoin on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ffffff", padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#f7931a", display: "flex" }} />
          <div style={{ fontSize: 40, fontWeight: 700, color: "#2a1c10", display: "flex" }}>
            Mezo<span style={{ color: "#b8530a" }}>Lend</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700, color: "#2a1c10", letterSpacing: -2, lineHeight: 1.05 }}>Borrow dollars against your bitcoin.</div>
          <div style={{ fontSize: 32, color: "#5f5650" }}>Supply MUSD to earn. Post BTC to borrow. Every rate and loan on-chain on Mezo.</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {["Live on Mezo Testnet", "Verified contracts", "Self-custody"].map((t) => (
            <div key={t} style={{ fontSize: 24, color: "#b8530a", background: "#fff1e3", border: "2px solid #ffd9b5", borderRadius: 999, padding: "8px 20px", display: "flex" }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
