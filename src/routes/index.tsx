import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Landing Page" },
      { name: "description", content: "Em desenvolvimento" },
      { property: "og:title", content: "Landing Page" },
      { property: "og:description", content: "Em desenvolvimento" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background">
      {/* Desenvolva sua landing page aqui */}
    </main>
  );
}
