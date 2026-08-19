import { Controller, Post, Body, Req, Res, Get, UseGuards, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Request, Response } from 'express';
import { JwtAuthGuard, IS_PUBLIC_KEY } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { SetMetadata } from '@nestjs/common';

const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setCookies(res: Response, accessToken: string, refreshToken: string) {
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.register(dto);
    this.setCookies(res, tokens.accessToken, tokens.refreshToken);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip;
    const tokens = await this.authService.login(dto, userAgent, ipAddress);
    this.setCookies(res, tokens.accessToken, tokens.refreshToken);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies['refreshToken'] || req.body.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip;
    const tokens = await this.authService.refresh(refreshToken, userAgent, ipAddress);
    this.setCookies(res, tokens.accessToken, tokens.refreshToken);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: { sessionId: string }, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(user.sessionId);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: { userId: string }) {
    return this.authService.getMe(user.userId);
  }
}
