import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * One shape for every case study, so a project is content rather than
 * layout. Adding or replacing a project is a markdown file — no
 * component work — which is what makes the Brahmo overhaul a drop-in.
 */
const projects = defineCollection({
  loader: glob({ base: "./src/content/projects", pattern: "**/*.md" }),
  schema: z.object({
    order: z.number(),
    name: z.string(),
    kana: z.string().optional(),
    tagline: z.string(),
    context: z.string().optional(),
    status: z.enum(["shipped", "in-progress"]).default("shipped"),
    stack: z.array(z.string()).default([]),

    links: z
      .array(
        z.object({
          label: z.string(),
          href: z.string().url(),
          kind: z.enum(["live", "repo"]).default("repo"),
        })
      )
      .default([]),

    /** The four figures worth putting on a keycap. */
    metrics: z
      .array(
        z.object({
          value: z.string(),
          label: z.string(),
          note: z.string().optional(),
          kana: z.string().optional(),
        })
      )
      .default([]),

    /** What a conventional approach uses, and what this uses instead. */
    swaps: z.array(z.object({ from: z.string(), to: z.string() })).default([]),

    /** A two-controller comparison across scenarios. */
    benchmark: z
      .object({
        caption: z.string(),
        unit: z.string(),
        max: z.number(),
        seriesA: z.string(),
        seriesB: z.string(),
        summary: z.string(),
        rows: z.array(
          z.object({
            scenario: z.string(),
            a: z.number(),
            b: z.number(),
            clean: z.string(),
            p95: z.number(),
          })
        ),
      })
      .optional(),

    /** Stated plainly, because a case study that only wins is not evidence. */
    limits: z.array(z.string()).default([]),
  }),
});

export const collections = { projects };
