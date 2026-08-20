import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(ConfigService) private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          let data = request?.cookies?.['accessToken'];
          if (!data) {
            data = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
          }
          return data;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET') as string,
    });
  }

  async validate(payload: any) {
    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException();
    }
    return { userId: payload.sub, sessionId: payload.sessionId };
  }
}
