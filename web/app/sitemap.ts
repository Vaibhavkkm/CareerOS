import type { MetadataRoute } from 'next';

const SITE = 'https://careeros.vaibhavkkm.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/hunt`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${SITE}/pipeline`, changeFrequency: 'weekly', priority: 0.5 },
  ];
}
