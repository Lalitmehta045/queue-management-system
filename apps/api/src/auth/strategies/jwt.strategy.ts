import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          let data = request?.cookies?.['accessToken'] as string | undefined;
          if (!data) {
            data = ExtractJwt.fromAuthHeaderAsBearerToken()(request) as string | undefined;
          }
          return data || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET') as string,
    });
  }

  validate(payload: { sub: string, sessionId: string }) {
    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException();
    }
    return { userId: payload.sub, sessionId: payload.sessionId };
  }
}
