import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col items-start px-4 py-28 sm:px-6">
      <p className="t-num text-[13px] font-semibold text-tang-deep">404</p>
      <h1 className="t-title mt-2 text-[34px]">This page doesn&apos;t exist</h1>
      <p className="mt-3 max-w-md text-[15.5px] text-mute">The link may be old, or the address mistyped. Your positions are safe on-chain either way.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/">
          <Button variant="solid">Back to home</Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="outline">Open dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
