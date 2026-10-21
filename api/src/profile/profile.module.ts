import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { mkdirSync, unlink } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';
import { IsNotEmpty, Matches, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/auth';

const PHONE = /^[+0-9][0-9 -]{6,18}$/;

/** The only details an employee may change themselves: contact number (and picture, below). Everything else is managed by HR. */
class ProfileDto {
  @Matches(PHONE, { message: 'Enter a valid phone number' }) phone: string;
}

const AVATAR_DIR = join(__dirname, '..', '..', 'uploads', 'avatars');
const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
mkdirSync(AVATAR_DIR, { recursive: true });

const avatarUpload = FileInterceptor('file', {
  storage: diskStorage({
    destination: AVATAR_DIR,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${AVATAR_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) =>
    AVATAR_TYPES[file.mimetype] ? cb(null, true) : cb(new BadRequestException('Only JPG, PNG or WebP images are allowed'), false),
});

/** Real image check by file signature, so a renamed non-image is rejected. */
async function isImage(path: string) {
  const { open } = await import('fs/promises');
  const fh = await open(path, 'r');
  const { buffer } = await fh.read(Buffer.alloc(12), 0, 12, 0);
  await fh.close();
  const hex = buffer.toString('hex');
  return hex.startsWith('ffd8ff') || hex.startsWith('89504e47') || (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
}

const removeFile = (url?: string | null) => {
  if (url?.startsWith('/api/uploads/avatars/')) unlink(join(AVATAR_DIR, url.split('/').pop()!), () => undefined);
};

class PasswordDto {
  @IsNotEmpty() currentPassword: string;
  @MinLength(8, { message: 'New password must be at least 8 characters' }) newPassword: string;
}

const mask = (v?: string | null, keep = 4) => (v ? `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : null);

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async get(u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: u.userId },
      include: {
        employee: {
          include: {
            department: { select: { name: true } },
            designation: { select: { name: true } },
            manager: { select: { firstName: true, lastName: true, email: true } },
            headOf: { select: { name: true } },
          },
        },
      },
    });
    const e = user.employee;
    return {
      account: { email: user.email, role: user.role, createdAt: user.createdAt, avatarUrl: user.avatarUrl },
      employee: e && {
        code: e.code,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone,
        gender: e.gender,
        dob: e.dob,
        address: e.address,
        emergencyName: e.emergencyName,
        emergencyPhone: e.emergencyPhone,
        joiningDate: e.joiningDate,
        status: e.status,
        department: e.department?.name,
        designation: e.designation?.name,
        manager: e.manager && { name: `${e.manager.firstName} ${e.manager.lastName}`, email: e.manager.email },
        heads: e.headOf.map((d) => d.name),
        // Sensitive values are masked; full values are only visible to HR
        pan: mask(e.pan),
        uan: mask(e.uan),
        bankName: e.bankName,
        bankAccount: mask(e.bankAccount),
        ifsc: e.ifsc,
      },
    };
  }

  async update(u: AuthUser, dto: ProfileDto) {
    if (!u.employeeId) throw new BadRequestException('No employee profile linked to this login');
    await this.prisma.employee.update({ where: { id: u.employeeId }, data: { phone: dto.phone.trim() } });
    return this.get(u);
  }

  async setAvatar(u: AuthUser, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose an image to upload');
    if (!(await isImage(file.path))) {
      removeFile(`/api/uploads/avatars/${file.filename}`);
      throw new BadRequestException('The file is not a valid image');
    }
    const old = await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId }, select: { avatarUrl: true } });
    await this.prisma.user.update({ where: { id: u.userId }, data: { avatarUrl: `/api/uploads/avatars/${file.filename}` } });
    removeFile(old.avatarUrl);
    return this.get(u);
  }

  async removeAvatar(u: AuthUser) {
    const old = await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId }, select: { avatarUrl: true } });
    await this.prisma.user.update({ where: { id: u.userId }, data: { avatarUrl: null } });
    removeFile(old.avatarUrl);
    return this.get(u);
  }

  async changePassword(u: AuthUser, dto: PasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('New password must be different from the current one');
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) } });
    return { ok: true };
  }
}

@Controller('profile')
export class ProfileController {
  constructor(private svc: ProfileService) {}

  @Get() get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u);
  }

  @Patch() update(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) {
    return this.svc.update(u, dto);
  }

  @Post('avatar') @UseInterceptors(avatarUpload) avatar(@CurrentUser() u: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.setAvatar(u, file);
  }

  @Delete('avatar') removeAvatar(@CurrentUser() u: AuthUser) {
    return this.svc.removeAvatar(u);
  }

  @Post('password') password(@CurrentUser() u: AuthUser, @Body() dto: PasswordDto) {
    return this.svc.changePassword(u, dto);
  }
}

@Module({ controllers: [ProfileController], providers: [ProfileService] })
export class ProfileModule {}
