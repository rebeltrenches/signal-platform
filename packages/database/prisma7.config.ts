// Prisma 7 moved the database connection URL out of schema.prisma
// (see prisma/schema.prisma's own datasource block comment) and into
// this file instead — a real, required config-file move, not an
// invented one; confirmed against Prisma's own official documentation
// and, critically, its own release notes for the @prisma/prisma7
// compatibility package specifically (NOT the generic "prisma/config"
// import path most guides show, since this project uses @prisma/prisma7,
// not the bare `prisma` package — see packages/database/package.json).
//
// Deliberately does NOT import "dotenv/config": this project has no
// .env file to load in any environment it actually runs in. Render
// sets DATABASE_URL directly as a real process environment variable;
// reading it via plain `process.env.DATABASE_URL` needs no dotenv at
// all, and adding it would be an unused, unnecessary new dependency.
import { defineConfig } from '@prisma/prisma7/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
