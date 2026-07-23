export type RateLimitTopology = {
  store: 'memory' | 'redis';
  redisUrl?: string;
  replicaCount: number;
  databaseUrl: string;
};

export type RateLimitTopologyIssue = {
  path: 'RATE_LIMIT_REDIS_URL' | 'RATE_LIMIT_STORE' | 'DATABASE_URL';
  message: string;
};

export function getRateLimitTopologyIssues(topology: RateLimitTopology): RateLimitTopologyIssue[] {
  const issues: RateLimitTopologyIssue[] = [];
  if (topology.store === 'redis' && !topology.redisUrl) {
    issues.push({
      path: 'RATE_LIMIT_REDIS_URL',
      message: 'RATE_LIMIT_REDIS_URL is required when RATE_LIMIT_STORE=redis',
    });
  }
  if (topology.replicaCount > 1 && topology.store !== 'redis') {
    issues.push({
      path: 'RATE_LIMIT_STORE',
      message: 'Multiple backend replicas require RATE_LIMIT_STORE=redis',
    });
  }
  if (topology.replicaCount > 1 && topology.databaseUrl.startsWith('file:')) {
    issues.push({
      path: 'DATABASE_URL',
      message: 'SQLite DATABASE_URL cannot be used with multiple backend replicas',
    });
  }
  return issues;
}
