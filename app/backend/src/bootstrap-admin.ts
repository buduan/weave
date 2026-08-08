import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { PrismaClient, UserStatus, MemberStatus } from '@prisma/client';
import * as argon2 from 'argon2';

import { normalizeEmail, normalizeUsername, validatePassword } from '@weave/utils';
import { ensureWorkspaceMemberSampleData } from './workspaces/workspace-member-sample-data';

export interface BootstrapAdminInput {
  email: string;
  name: string;
  nickname: string;
  password: string;
  username: string;
}

function validateInput(input: BootstrapAdminInput): void {
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(input.username)) throw new Error('Invalid username');
  if (!input.name || input.name.length > 128) throw new Error('Invalid name');
  if (!input.nickname || input.nickname.length > 128) throw new Error('Invalid nickname');
  if (!validatePassword(input.password).valid) throw new Error('Password does not meet policy');
}

export function nonInteractiveInput(environment: NodeJS.ProcessEnv): BootstrapAdminInput {
  const required = [
    'BOOTSTRAP_ADMIN_EMAIL',
    'BOOTSTRAP_ADMIN_USERNAME',
    'BOOTSTRAP_ADMIN_NAME',
    'BOOTSTRAP_ADMIN_NICKNAME',
    'BOOTSTRAP_ADMIN_PASSWORD',
  ] as const;
  const missing = required.filter((name) => !environment[name]);
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  const input = {
    email: normalizeEmail(environment.BOOTSTRAP_ADMIN_EMAIL as string),
    username: normalizeUsername(environment.BOOTSTRAP_ADMIN_USERNAME as string),
    name: (environment.BOOTSTRAP_ADMIN_NAME as string).trim(),
    nickname: (environment.BOOTSTRAP_ADMIN_NICKNAME as string).trim(),
    password: environment.BOOTSTRAP_ADMIN_PASSWORD as string,
  };
  validateInput(input);
  return input;
}

async function hiddenQuestion(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('An interactive terminal is required for password input');
  }
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    let onData: (input: string) => void = () => undefined;
    const finish = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    onData = (input: string): void => {
      if (input === '\u0003') {
        finish();
        reject(new Error('Bootstrap cancelled'));
        return;
      }
      if (input === '\r' || input === '\n') {
        finish();
        resolve(value);
        return;
      }
      if (input === '\u007f' || input === '\b') value = value.slice(0, -1);
      else value += input;
    };
    stdin.on('data', onData);
  });
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function interactiveInput(): Promise<BootstrapAdminInput> {
  const emailArgument = argument('email');
  if (!emailArgument) throw new Error('Usage: pnpm bootstrap:admin --email=admin@example.com');

  const prompt = createInterface({ input: stdin, output: stdout });
  const username = normalizeUsername(await prompt.question('Username: '));
  const name = (await prompt.question('Name: ')).trim();
  const nickname = (await prompt.question('Nickname: ')).trim();
  prompt.close();
  const password = await hiddenQuestion('Initial password: ');
  const input = {
    email: normalizeEmail(emailArgument), username, name, nickname, password,
  };
  validateInput(input);
  return input;
}

async function main(): Promise<void> {
  if (process.argv.some((value) => value.startsWith('--password'))) {
    throw new Error('Password arguments are forbidden; use the interactive prompt or BOOTSTRAP_ADMIN_PASSWORD.');
  }
  if (!process.argv.includes('--non-interactive') && (!stdin.isTTY || !stdout.isTTY)) {
    throw new Error('Use --non-interactive with BOOTSTRAP_ADMIN_* environment variables outside an interactive terminal.');
  }
  const prisma = new PrismaClient();
  try {
    if (await prisma.systemAdministrator.count() > 0) {
      stdout.write('System administrator already initialized; no changes made.\n');
      return;
    }
    const input = process.argv.includes('--non-interactive')
      ? nonInteractiveInput(process.env)
      : await interactiveInput();
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          username: input.username,
          name: input.name,
          nickname: input.nickname,
          passwordHash,
          passwordUpdatedAt: new Date(),
          emailVerifiedAt: new Date(),
          status: UserStatus.active,
        },
      });
      const workspace = await tx.workspace.create({
        data: { name: 'Default Workspace', slug: 'default', ownerUserId: user.id },
      });
      if (workspace.id !== 1) throw new Error('Default Workspace must receive ID 1');
      const memberType = await tx.workspaceMemberType.create({
        data: {
          workspaceId: workspace.id,
          name: 'Member',
          slug: 'member',
          isSystem: true,
        },
      });
      await tx.workspaceMemberType.create({
        data: {
          workspaceId: workspace.id,
          name: 'Guest',
          slug: 'guest',
          isSystem: true,
        },
      });
      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          memberTypeId: memberType.id,
          status: MemberStatus.active,
          isWorkspaceAdmin: true,
          joinedAt: new Date(),
        },
      });
      const role = await tx.role.create({
        data: {
          workspaceId: workspace.id,
          code: 'member',
          name: 'Member',
          isSystem: true,
          isDefault: true,
        },
      });
      await tx.memberRole.create({
        data: { memberId: member.id, roleId: role.id, assignedByUserId: user.id },
      });
      await tx.systemAdministrator.create({ data: { userId: user.id } });
      const sampleData = await ensureWorkspaceMemberSampleData(tx, {
        workspaceId: workspace.id,
        workspaceMemberId: member.id,
        userId: user.id,
      });
      await tx.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          actorType: 'bootstrap',
          action: 'system.bootstrap',
          resourceType: 'workspace',
          resourceId: String(workspace.id),
          result: 'success',
          metadata: {
            sampleData: {
              created: sampleData.created,
              datasetId: sampleData.datasetId,
              formId: sampleData.formId,
            },
          },
        },
      });
    });
    stdout.write('Default Workspace and first system administrator created.\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
