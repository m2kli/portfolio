import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One Markdown file per work per language:
//   src/content/works/zh/<slug>.md   src/content/works/en/<slug>.md
// Asset paths (cover, gallery, video src, playable path) are relative to /public.
const works = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/works' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    year: z.number().optional(),
    role: z.string().optional(),
    team: z.string().optional(),
    duration: z.string().optional(),
    engine: z.string().optional(),
    platforms: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    cover: z.string(),
    // wide: always span the full row (for long strips such as pacing curves)
    gallery: z.array(z.object({ src: z.string(), caption: z.string().optional(), wide: z.boolean().optional() })).default([]),
    // images shown inside the design-notes section (maps, flow, pacing from the workbench)
    notes: z.array(z.object({ src: z.string(), caption: z.string().optional(), wide: z.boolean().optional() })).default([]),
    video: z
      .object({
        type: z.enum(['youtube', 'bilibili', 'local']),
        // youtube: video id · bilibili: BV id · local: path under /public
        src: z.string(),
        poster: z.string().optional(),
      })
      .optional(),
    playable: z
      .object({
        // an entry file under /public (e.g. demos/level-workbench/index.html) or a full URL (itch.io embed, etc.)
        src: z.string(),
        aspect: z.string().default('16/9'),
        note: z.string().optional(),
      })
      .optional(),
    links: z
      .array(
        z.object({
          type: z.enum(['itch', 'steam', 'download', 'github', 'website', 'video']),
          url: z.string(),
          label: z.string().optional(),
        }),
      )
      .default([]),
    order: z.number().default(0),
    featured: z.boolean().default(true),
  }),
});

export const collections = { works };
