# herdr-worktree-hook

[English](README.md)

새 git worktree는 깨끗한 체크아웃이라 `.env`도, `node_modules`도, git이 무시하는 파일도 없습니다.
herdr-worktree-hook은 worktree를 어떻게 만들었든(`git worktree add`, 에디터, 에이전트,
[Herdr](https://herdr.dev)) 새 worktree를 대신 준비해 줍니다.

1. 메인 체크아웃에서 `.env` 같은 로컬 파일을 복사하고,
2. `yarn install` 같은 설정 명령을 백그라운드에서 실행합니다. 그래서 `git worktree add`는 바로 끝납니다.

무엇을 복사하고 실행할지는 저장소마다 홈 폴더에 설정합니다. 저장소에는 아무것도 들어가지 않고,
체크아웃한 브랜치나 PR이 실행할 명령을 바꿀 수 없습니다.

## 필요한 것

- git 2.54 이상 (git config로 훅을 등록합니다)
- python3
- macOS 또는 Linux (macOS에서 테스트했습니다)

## 설치

```sh
git clone https://github.com/kimsuhan/herdr-worktree-hook
mkdir -p ~/.local/bin && ln -s "$PWD/herdr-worktree-hook/bin/herdr-worktree-hook" ~/.local/bin/
herdr-worktree-hook install
```

`install`은 `~/.gitconfig`에 전역 `post-checkout` 훅을 추가합니다. Husky를 포함한 다른 훅은 그대로
동작합니다. `herdr-worktree-hook uninstall`로 제거합니다.

아무 저장소에서나 확인해 보세요.

```sh
git worktree add ../try-it -b try-it
# herdr-worktree-hook: github.com/you/app: copied .env
```

## 설정

`~/.config/herdr/plugins/config/kimsuhan.worktree-hook/config.json`
(`$XDG_CONFIG_HOME`을 따릅니다):

```json
{
  "default": {
    "copy": [".env", ".env.*", ".vscode/"]
  },
  "repos": {
    "github.com/acme/api": {
      "run": ["yarn install --frozen-lockfile", "npx prisma generate"],
      "skip_run": ["review-*"]
    }
  }
}
```

필드마다 아래 순서로 찾고, 먼저 값이 있는 쪽을 씁니다.

1. `repos` 아래 그 저장소의 설정
2. `default`: 자기 값이 없는 모든 저장소에 적용
3. 내장 기본값: `copy`는 `.env`와 `.env.*`, `run`과 `skip_run`은 비어 있음

위 예시에서 `acme/api`는 `default`의 `.env`, `.env.*`, `.vscode/`를 복사하고 자기 명령을 실행합니다.
설정 파일이 없으면 모든 저장소가 `.env`와 `.env.*`만 복사하고 아무것도 실행하지 않습니다.

| 필드 | 하는 일 |
| --- | --- |
| `copy` | 메인 체크아웃 기준 경로입니다. glob을 쓸 수 있고 폴더는 끝에 `/`를 붙입니다. git이 무시하는 파일만 복사하고, worktree에 이미 있는 파일은 덮어쓰지 않습니다. |
| `run` | 새 worktree에서 차례로 실행하는 명령입니다. 로그인 셸의 `PATH`를 쓰므로 nvm, asdf 등이 동작합니다. 하나가 실패하면 나머지는 실행하지 않습니다. 명령에는 `WT_PATH`, `WT_REPO_ROOT`(메인 체크아웃), `WT_BRANCH`가 전달됩니다. |
| `skip_run` | 브랜치 이름이나 worktree 폴더 이름이 맞으면 `run`을 건너뛰는 패턴입니다. 예: `review-*` |

저장소 키는 `origin` 리모트에서 프로토콜과 `.git`을 뺀 값입니다(https든 ssh든 `github.com/acme/api`).
`origin`이 없으면 메인 체크아웃 경로를 씁니다.

훅은 worktree마다 한 번만 준비합니다. 복사하지 못한 파일은 알려 주고 나머지를 계속 진행합니다.
`config.json`이 올바르지 않으면(예: 목록 자리에 문자열) 메시지를 남기고 준비를 멈추지만,
`git worktree add`는 그대로 성공합니다. 실행 기록은 최근 100개만 남깁니다.

파일을 직접 고치거나 명령으로 바꿀 수 있습니다.

```sh
herdr-worktree-hook key                       # 이 저장소의 키
herdr-worktree-hook show                      # 이 저장소의 새 worktree가 받는 설정
echo '{"run": ["yarn install"]}' | herdr-worktree-hook set github.com/acme/api
herdr-worktree-hook rm github.com/acme/api
```

## 명령

| 명령 | |
| --- | --- |
| `install`, `uninstall` | 전역 git 훅을 추가하거나 제거합니다. |
| `run [path]` | 기존 worktree를 다시 준비합니다. |
| `history [-n N] [--json]` | 최근 실행과 상태, 로그 파일을 보여 줍니다. |
| `show [path]`, `key [path]` | 저장소에 적용되는 설정과 키를 보여 줍니다. |
| `ls`, `set KEY`, `rm KEY` | 전체 설정을 JSON으로 보여 주고, 항목 하나를 저장하거나 지웁니다(`default` 포함). |

로그는 `~/.local/state/herdr/plugins/kimsuhan.worktree-hook/runs/`에 있습니다(`$XDG_STATE_HOME`을
따릅니다). 명령을 찾지 못한다는 오류가 나면 로그인 셸의 `PATH`에 그 명령이 있는지 확인하세요.

## Herdr 패널 (선택)

[Herdr 앱](https://herdr.dev)을 쓰면 사이드 패널에서 지금 스페이스의 저장소에 적용되는 설정을 보고,
고치고, worktree를 다시 준비하고, 최근 실행과 로그를 볼 수 있습니다. 실행이 실패하면 알림이 뜹니다.

```sh
cp -R herdr-worktree-hook/app/mods/worktree-hook ~/.config/herdr-app/mods/
```

Herdr가 처음 발견할 때 오른쪽에 붙이고, 그 뒤로는 레이아웃에서 위치를 정합니다.
CLI는 `PATH`나 `~/.local/bin`에서 찾습니다. 다른 머신의 스페이스는 아직 지원하지 않습니다.

## 개발

`./test.sh`는 임시 폴더에 실제 worktree를 만들어 확인하며, 내 git과 Herdr 설정에는 영향을 주지 않습니다.

## 라이선스

MIT
