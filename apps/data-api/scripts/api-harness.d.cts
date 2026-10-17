import type { Application } from 'express';
export function loadApp(): Application;
export function request(app: Application, method: string, url: string, body?: string, headers?: Record<string, string>): Promise<{
  status: number;
  headers: Record<string, string | number | string[] | undefined>;
  body: string;
}>;
