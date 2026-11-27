import { z } from 'zod';
import rawData from '../data/tools.json';

const httpUrlSchema = z
  .string()
  .url('必须是合法的 URL')
  .refine(
    (val) => val.startsWith('https://') || val.startsWith('http://'),
    'URL 必须以 http:// 或 https:// 开头'
  );

const toolLinkSchema = z.object({
  type: z.enum(['docs', 'github', 'other']).default('other'),
  label: z.string().min(1, '次级链接 label 不能为空'),
  url: httpUrlSchema,
});

const categorySchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, '分类 id 仅允许小写字母、数字和短横线'),
  name: z.string().min(1, '分类名称不能为空'),
});

const toolSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, '工具 id 仅允许小写字母、数字和短横线'),
  name: z.string().min(1, '工具名称不能为空'),
  url: httpUrlSchema,
  description: z.string().min(1, '工具简介不能为空').max(120, '工具简介不能超过 120 字'),
  category: z.string().min(1, '分类不能为空'),
  tags: z.array(z.string().min(1)).default([]),
  keywords: z.array(z.string().min(1)).default([]),
  icon: z.string().min(1).optional(),
  links: z.array(toolLinkSchema).max(2, '每个工具最多配置 2 个次级链接').default([]),
});

const toolsConfigSchema = z
  .object({
    $schema: z.string().optional(),
    categories: z.array(categorySchema).min(1, '至少需要定义一个分类'),
    tools: z.array(toolSchema).min(1, '至少需要配置一个工具'),
  })
  .superRefine((data, ctx) => {
    const categoryIds = new Set<string>();
    data.categories.forEach((cat, idx) => {
      if (categoryIds.has(cat.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `存在重复的分类 id: "${cat.id}"`,
          path: ['categories', idx, 'id'],
        });
      }
      categoryIds.add(cat.id);
    });

    const toolIds = new Set<string>();
    data.tools.forEach((tool, idx) => {
      if (toolIds.has(tool.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `存在重复的工具 id: "${tool.id}"`,
          path: ['tools', idx, 'id'],
        });
      }
      toolIds.add(tool.id);

      if (!categoryIds.has(tool.category)) {
        ctx.addIssue({
          code: 'custom',
          message: `工具 "${tool.name}" 引用了不存在的分类 id: "${tool.category}"`,
          path: ['tools', idx, 'category'],
        });
      }
    });
  });

const parsed = toolsConfigSchema.safeParse(rawData);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`)
    .join('\n');
  throw new Error(`src/data/tools.json 校验失败:\n${details}`);
}

export type Category = z.infer<typeof categorySchema>;
export type ToolLink = z.infer<typeof toolLinkSchema>;
export type ToolItem = z.infer<typeof toolSchema>;

export interface EnrichedTool extends ToolItem {
  index: number;
  hostname: string;
  faviconUrl: string;
  initial: string;
  categoryName: string;
}

const categoryMap = new Map(parsed.data.categories.map((c) => [c.id, c.name]));

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getMonogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

export const categories: Category[] = parsed.data.categories;

export const tools: EnrichedTool[] = parsed.data.tools.map((tool, index) => {
  const hostname = extractHostname(tool.url);
  const faviconUrl =
    tool.icon ??
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
  return {
    ...tool,
    index,
    hostname,
    faviconUrl,
    initial: getMonogram(tool.name),
    categoryName: categoryMap.get(tool.category) ?? tool.category,
  };
});

const tagCounts = new Map<string, number>();
for (const tool of tools) {
  for (const tag of tool.tags) {
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
}

export const allTags: { name: string; count: number }[] = Array.from(tagCounts.entries())
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
