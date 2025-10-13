import { Test, TestingModule } from '@nestjs/testing';
import { InstallersService } from './installers.service';

describe('InstallersService', () => {
  let service: InstallersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InstallersService],
    }).compile();

    service = module.get<InstallersService>(InstallersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
