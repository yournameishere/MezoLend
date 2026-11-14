import { MarketDetail } from "@/components/market/MarketDetail";

export default async function MarketPage({ params }: PageProps<"/markets/[id]">) {
  const { id } = await params;
  const n = Number(id);
  return <MarketDetail id={Number.isInteger(n) && n >= 0 ? n : -1} />;
}
