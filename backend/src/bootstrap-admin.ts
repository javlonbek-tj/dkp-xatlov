import { UserRole } from '@prisma/client';
import { prisma } from './db.js';
import { hashPassword } from './password.js';

function prompt(label: string, hidden = false): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) throw new Error('Run this command in an interactive terminal');

  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();

    const finish = (result?: string, error?: Error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(result ?? '');
    };

    const onData = (data: Buffer) => {
      for (const character of data.toString()) {
        if (character === '\u0003') {
          finish(undefined, new Error('Cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          if (hidden) process.stdout.write('\b \b');
          continue;
        }
        if (character >= ' ') {
          value += character;
          process.stdout.write(hidden ? '*' : character);
        }
      }
    };

    input.on('data', onData);
  });
}

async function main() {
  const existingAdmins = await prisma.user.count({ where: { role: UserRole.ADMIN } });
  if (existingAdmins > 0) {
    throw new Error('An administrator already exists. Use the authenticated user management page.');
  }

  const username = (await prompt('Administrator username: ')).trim().toLowerCase();
  const fullName = (await prompt('Administrator full name: ')).trim();
  const password = await prompt('Administrator password: ', true);
  const confirmation = await prompt('Repeat password: ', true);
  if (!username || username.length > 100 || !fullName || fullName.length > 150 || !password || password.length > 200) {
    throw new Error('Enter a username (up to 100 characters), full name (up to 150), and password (up to 200)');
  }
  if (password !== confirmation) throw new Error('Passwords do not match');

  const admin = await prisma.user.create({
    data: { username, fullName, passwordHash: await hashPassword(password), role: UserRole.ADMIN },
    select: { username: true },
  });
  console.log(`Administrator account created: ${admin.username}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unable to create administrator');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
