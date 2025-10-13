import { Test, TestingModule } from '@nestjs/testing';
import { InstallersController } from './installers.controller';

describe('InstallersController', () => {
  let controller: InstallersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstallersController],
    }).compile();

    controller = module.get<InstallersController>(InstallersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
