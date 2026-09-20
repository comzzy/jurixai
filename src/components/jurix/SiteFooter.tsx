import { Link } from "@tanstack/react-router";
import { CHAIN_DISPLAY_NAME, TOKEN_SYMBOL } from "@/lib/chain";

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-24 py-12 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-sm text-muted-foreground text-center md:text-left">
          © 2026 JuriXAI — Autonomous hackathon judging
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-accent">
            <span className="size-1.5 rounded-full bg-accent" />
            Built on {CHAIN_DISPLAY_NAME} · Paid in {TOKEN_SYMBOL}
          </span>
          <Link to="/docs" className="hover:text-foreground transition-colors">
            Docs
          </Link>
          <a
            href="https://github.com/comzzy-comzzy/jurixai"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://www.circle.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Circle
          </a>
        </div>
      </div>
    </footer>
  );
}
