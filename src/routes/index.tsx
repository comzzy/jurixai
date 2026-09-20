import { createFileRoute, Link } from "@tanstack/react-router";
import { StatsBar } from "@/components/jurix/StatsBar";
import { HackathonCard } from "@/components/jurix/HackathonCard";
import { JudgePanel } from "@/components/jurix/JudgePanel";
import { JudgeActivityFeed } from "@/components/jurix/JudgeActivityFeed";
import { Leaderboard } from "@/components/jurix/Leaderboard";
import { loadHomeData } from "@/lib/jurix/actions.server";

export const Route = createFileRoute("/")({
  loader: () => loadHomeData(),
  head: () => ({
    meta: [
      { title: "JuriXAI — Host a hackathon. AI agents judge it." },
      {
        name: "description",
        content:
          "Autonomous evaluation for onchain builders. Real submissions, real agent verdicts, and live scoring data.",
      },
      { property: "og:title", content: "JuriXAI — Autonomous hackathon judging" },
      {
        property: "og:description",
        content:
          "Four specialized AI judges score every submission with traceable evidence and weighted rubrics.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const data = Route.useLoaderData();

  return (
    <div className="max-w-7xl mx-auto px-6 py-12 md:py-16">
      <section className="mb-20 animate-slide-in">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 mb-6 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
            Four specialized AI judges, scoring now live on Arc Mainnet
          </div>
          <h1 className="font-semibold italic text-3xl md:text-4xl lg:text-5xl tracking-tight leading-[1.1] text-balance mb-6">
            Host a hackathon. <span className="text-muted-foreground">AI agents judge it.</span>{" "}
            <span className="text-accent">Real scoring, no mock results.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl text-pretty">
            JuriXAI evaluates real submissions with specialized judge agents for code quality,
            product value, originality, and shipping quality.
          </p>
          <div className="flex flex-wrap gap-3 mb-12">
            <Link
              to="/create"
              className="rounded-lg bg-accent text-accent-foreground px-5 py-3 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity"
            >
              Host a hackathon
            </Link>
            <Link
              to="/hackathons"
              className="rounded-lg border border-border hover:bg-muted transition-colors text-foreground px-5 py-3 text-sm font-semibold"
            >
              Browse live hackathons
            </Link>
          </div>
          <StatsBar stats={data.stats} />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-8 space-y-8">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h2 className="text-sm font-semibold text-foreground">
              Active hackathons{" "}
              <span className="text-muted-foreground font-normal">
                ({data.featured_hackathons.length})
              </span>
            </h2>
            <Link to="/hackathons" className="text-sm font-semibold text-accent hover:opacity-80">
              View all →
            </Link>
          </div>
          {data.featured_hackathons.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground text-sm">
              No live hackathons yet. Connect Supabase and create your first event.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.featured_hackathons.map((hackathon, i) => (
                <HackathonCard
                  key={hackathon.id}
                  hackathon={hackathon}
                  index={i}
                  submissionCount={hackathon.submission_count}
                />
              ))}
            </div>
          )}
        </div>
        <aside className="lg:col-span-4">
          <div className="sticky top-20 space-y-6">
            <JudgePanel judges={data.active_agents} />
            <JudgeActivityFeed events={data.recent_activity} />
          </div>
        </aside>
      </div>

      <section className="mt-24">
        <div className="flex items-center gap-4 mb-8">
          <h2 className="text-2xl md:text-3xl font-bold italic tracking-tight">
            Live standings:{" "}
            <span className="text-accent">
              {data.leaderboard_hackathon?.name ?? "Waiting for submissions"}
            </span>
          </h2>
          <div className="h-px flex-1 bg-border" />
          {data.leaderboard_hackathon && (
            <Link
              to="/hackathons/$id"
              params={{ id: data.leaderboard_hackathon.id }}
              className="text-sm font-semibold text-accent hover:opacity-80 shrink-0"
            >
              Full board →
            </Link>
          )}
        </div>
        {data.leaderboard_hackathon && data.leaderboard_submissions.length > 0 ? (
          <Leaderboard
            hackathonId={data.leaderboard_hackathon.id}
            projects={data.leaderboard_submissions}
          />
        ) : (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground text-sm">
            Leaderboard unlocks when real submissions and agent evaluations arrive.
          </div>
        )}
      </section>
    </div>
  );
}
