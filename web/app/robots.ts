import type { MetadataRoute } from 'next';

const SITE = 'https://careeros.vaibhavkkm.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
