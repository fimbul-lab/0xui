import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "@/components/layout/home";
import { baseOptions } from "@/lib/layout.shared";
import { ChainSelector } from "../../registry/components/chain-selector/chain-selector";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-col flex-1  px-4 py-8 text-center">
        <div className="flex flex-col items-center justify-center h-screen max-h-[600px] gap-4">
          <h1 className="font-bold text-5xl">Components for Web3 Developers</h1>
          <p className=" text-muted-foreground max-w-xl text-center">
            A set of beautifully designed components that you can customize,
            extend, and build on. Start here then make it your own. Open Source.
            Open Code.
          </p>
          <Link
            to="/docs/$"
            params={{
              _splat: "",
            }}
            className="px-3 py-2 mt-4 rounded-lg bg-fd-primary text-fd-primary-foreground font-medium text-sm mx-auto"
          >
            Open Docs
          </Link>
          <ChainSelector />
        </div>
      </div>
    </HomeLayout>
  );
}
