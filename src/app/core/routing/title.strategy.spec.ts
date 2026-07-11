import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import type { RouterStateSnapshot } from '@angular/router';
import { TitleStrategy } from '@angular/router';
import { APP_NAME, AppTitleStrategy } from './title.strategy';

describe('AppTitleStrategy', () => {
  let strategy: AppTitleStrategy;
  let titleService: Title;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AppTitleStrategy,
        Title,
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    });
    strategy = TestBed.inject(AppTitleStrategy);
    titleService = TestBed.inject(Title);
  });

  it('sets title with app name suffix when route has a title', () => {
    spyOn(strategy, 'buildTitle').and.returnValue('Dashboard');
    spyOn(titleService, 'setTitle');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(titleService.setTitle).toHaveBeenCalledWith(`Dashboard | ${APP_NAME}`);
  });

  it('sets only the app name when no route title is defined', () => {
    spyOn(strategy, 'buildTitle').and.returnValue(undefined);
    spyOn(titleService, 'setTitle');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(titleService.setTitle).toHaveBeenCalledWith(APP_NAME);
  });

  it('sets title with pipe separator correctly', () => {
    spyOn(strategy, 'buildTitle').and.returnValue('Login');
    spyOn(titleService, 'setTitle');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(titleService.setTitle).toHaveBeenCalledWith(`Login | ${APP_NAME}`);
  });

  it('APP_NAME constant equals expected app name', () => {
    expect(APP_NAME).toBe('Boilerplate Angular');
  });
});
