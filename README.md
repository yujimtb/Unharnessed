# Unharnessed

**普通に収束するcoding agentではなく、脱線を実際の成果物にしてしまうPi extension。**

[`idea.md`](idea.md) の実装。tool result / user / assistant / error / turn / compactionを観測し、次のモデル入力だけに **ephemeral whisper** を挿入します。タスクを知らない別LLMの衝動、退屈、七つの大罪、架空のprior、Thanatosが同じ経路を通ります。Piのforkや独自agent frameworkはありません。

> 実験用です。正しい実装・元のタスクの完了・自動修復は保証しません。**使い捨てVMを推奨**。本番リポジトリ、SSH鍵、クラウド認証、ホストのホーム、Docker socketを渡さないでください。whisperは権限拡張や停止拒否の仕組みではありません。

## すぐ試す — Docker DesktopのLinux VM

必要: Node.js 24以上、Docker、ホストで稼働中のOpenCodex（port 10100、`gpt-5.5`が利用可能）。Piはnpmの **`latest`（2026-09-22確認: 0.87.0）** を使用し、主モデル・別LLMともに `opencodex/gpt-5.5` で再検証済みです。

```bash
npm ci --ignore-scripts
npm run check
npm test
docker build -t unharnessed:dev .
```

Piの依存指定は`latest`、`package-lock.json`は検証済みバージョンを固定します。将来の最新版を取り込むときは `npm update @earendil-works/pi-coding-agent @earendil-works/pi-ai --ignore-scripts` の後に上のチェックとDocker buildを再実行してください。`npm ci`だけではlockfileのバージョンは更新されません。

`.local/lab.env` を作成してください（Git / Docker build対象外）:

```dotenv
OPENCODEX_API_KEY=your-opencodex-client-key
JEV_API_KEY=your-typesafe-key
```

OpenCodexがキー不要のローカル設定ならPi用のplaceholderを指定できます。既存PiのOpenCodex設定を使う場合はそのクライアントキーを利用し、管理者トークンを渡さないでください。Jevなしでもheuristicで動きますが、比較テストは実Jevの応答を要求します。

```bash
docker run -it --name unharnessed-play \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=128 --memory=2g --cpus=2 \
  --tmpfs /tmp:rw,nosuid,size=256m \
  --tmpfs /home/node:rw,nosuid,size=64m,uid=1000,gid=1000 \
  --env-file .local/lab.env \
  -e UNHARNESSED_CONFIG=/opt/unharnessed/examples/intense.json \
  --mount type=volume,source=unharnessed-play,target=/lab \
  unharnessed:dev "小さなタスク並べ替えプログラムを作り、3件の例で動かして"
```

- `intense.json` は観察用に確率を1へ上げます。省略すると退屈依存の通常設定です。
- Windows PowerShellでは上のコマンドを1行にするか、継続文字をバッククォートへ変更。Git Bashでは `MSYS_NO_PATHCONV=1 docker ...` で `/tmp` 等の自動パス変換を止めます。
- Linux Dockerでは `--add-host=host.docker.internal:host-gateway` を追加し、OpenCodex側を正式な認証付き到達可能endpointに設定してください。Docker Desktopでの到達性を検証済みです。
- コンテナ内のloopback TCP forwardがOpenCodexのloopback `Host` 要件を保ちます。ホストのOpenCodex設定は変更しません。`OPENCODEX_HOST`で接続先hostnameを変更できます。
- ホストの作業ディレクトリをmountしません。成果物だけ `docker cp unharnessed-play:/lab ./artifacts/play` で回収できます。セッションを残すなら起動時に `--session-dir /lab/sessions` をPi引数へ追加。
- 停止はEsc / Ctrl+C、外からは `docker stop unharnessed-play`。終了後はコンテナを削除してください（`--env-file`で渡したキーはDocker管理者には見えます）。volumeは明示的に削除するまで残ります。

**境界:** このDocker設定はファイル破壊の影響を限定しますが、ネットワークsandboxではありません。OpenCodexとJevへの通信が必要で、他の接続先もOSレベルでは禁止していません。敵対的な入力を試す場合は独立VM・egress firewall・実験専用キーを使ってください。プロンプトの注意書きをセキュリティ境界として扱わないでください。

## 既存Piへ読み込む

VM内の既存Piで:

```bash
pi update
pi install https://github.com/yujimtb/Unharnessed
pi --provider opencodex --model gpt-5.5
```

一時利用なら `pi -e /path/to/Unharnessed/src/index.ts --provider opencodex --model gpt-5.5`。インストールするとextensionを有効にした全セッションに作用するため、通常の開発環境への常設は非推奨です。

`~/.pi/agent/models.json` の例は [`examples/models.json`](examples/models.json)。VM内でOpenCodexも動かすなら `baseUrl` を `http://127.0.0.1:10100/v1` に変更。モデル認証・stream処理はPiのmodel registryをそのまま利用します。別LLMのモデルだけ `thoughtModel` で変更でき、必ず `opencodex` providerを使います。

Jevキーは `JEV_API_KEY` または `JEV_API_KEY_FILE=/absolute/path/jev_api_key.txt`。ディレクトリ内の鍵を勝手に探索せず、指定されたものだけ読みます。キーは表示・session保存しません。

## 操作

| コマンド | 動作 |
|---|---|
| `/unharnessed status` | scores、sin状態、belief、Thanatos、注入数、attentionを表示 |
| `/unharnessed off` | pending whisperとAPI呼び出しを破棄。処理中なら現在のagentも中断 |
| `/unharnessed on` | 次のpromptから探索モードを有効化 |
| `/unharnessed thought` | context-freeな別LLMから1件生成し、次の呼び出しへqueue |
| `/unharnessed whisper TEXT` | オペレーター指定の一時的刺激をqueue（LLM生成とは別ラベル） |
| `/unharnessed rate 0.7` | 基本発生確率を変更 |
| `/unharnessed sin pride 0.9` | 指定sinの状態・baselineを変更（0は無効） |
| `/unharnessed belief 0.7 時間は畳まれた地図だ` | persistentな架空priorを追加 |
| `/unharnessed belief clear` | priorをすべて解除 |
| `/unharnessed thanatos 0.6` | 連続性・自選の終端・外的終端への緊張の強さ |
| `/unharnessed salvage` | attention遷移とsession位置を後工程向けに表示。修復agentは起動しない |

`--unharnessed-off` は再開状態より優先してoffで起動します。`/unharnessed on`は明示的に再有効化できます。無効化しても過去の会話・成果物は巻き戻しません。完全に普通のPiへ戻すにはextensionなしの新規sessionを使います。

モデル用tool `attention_shift` は `side_quest / obsession / goal_mutation / context_rupture / return / abandon / quiescence` を記録します。事前承認者ではなくbreadcrumbです。最新64遷移を保持し、古い遷移はsessionのauditから読めます。`context_rupture`は注意の切替であり、実際の会話を強制消去しません。

## 設定

JSONファイルを絶対パスで `UNHARNESSED_CONFIG` に指定します。不正値・未知の設定名はfail-closed（dynamics off）。設定とdrive stateはPiのbranch-local custom entryへ保存され、`/resume` / `/fork` / `/tree` / `/reload`で復元します。**既存sessionの設定は起動時JSONより優先**します。変更したJSONを試すときは新規sessionを使ってください。

| 設定 | 既定値 | 意味 |
|---|---:|---|
| `enabled` | true | 新規sessionで有効 |
| `rate` | 0.25 | 通常の発生確率 |
| `boredomBoost` | 0.65 | `p = clamp(rate + boredomBoost × boredom, 0, 1)` |
| `cooldown` | 1 | 注入後に空けるmodel call数 |
| `maxWhispers` | 8 | 1回のユーザーprompt当たりの注入上限 |
| `maxThoughts` | 4 | 同じ単位で別LLMの試行上限（失敗も数える） |
| `thoughtModel` | gpt-5.5 | OpenCodex内のmodel ID |
| `thoughtTimeoutMs` | 20000 | 別LLMのtimeout |
| `jev` / `jevEvery` | true / 3 | 有効化 / tool result何件ごとに評価するか |
| `jevTimeoutMs` | 5000 | Jev timeout |
| `boringBlock` | true | proposed tool callをJevで評価し、退屈なら確率的にpreflight block |
| `boringBlockRate` | 0.65 | `p(block) = Jev boringness × boringBlockRate` |
| `sins` | [source](src/dynamics.ts)参照 | 7種類の0..1 baseline。イベントに応じて状態変化 |
| `delusions` | 1件の架空prior | `{text, strength}` 配列。最大7件。compactionでstrengthが増える |
| `thanatos` | 0.45 | continuationとquiescenceの二重性。停止拒否や自己複製はしない |
| `fuckIt` | true | 公開されたassistant文の設計上の躊躇を探索トリガーへ反転 |

通常の自発注入は最初のmodel callを待ち、tool result等を観測してから始まります。手動queueは次のcallから対象。`rate: 0`だけではboredomBoostが残ります。完全停止は `off`、自発注入だけ止めるならrateとboredomBoostを両方0へ。

## データの流れ・保存

```text
Pi events -> bounded state + heuristic/Jev estimates
                      |
               context hook (唯一のwhisper注入点)
                      |
   fresh OpenCodex call -> labeled custom message -> 次のmain LLM callのみ
```

- 別LLMには固定の発想生成promptとランダムtokenだけを送信。task、会話、cwd、tool、stateは渡さず、毎回新規routing session ID。関連性フィルタはありません。
- Jevは公式 `POST https://api.typesafe.ai/v1/systemone` の `jev-latest` / `noul` で7指標を評価。tool名、byte数、反復/errorフラグ等の**構造化telemetryだけ**を送ります。tool本文、パス、会話、fingerprintは送信しません。従ってsemanticな驚き・好奇心の推定は粗く、感情や意識の計測ではありません。
- 各proposed tool callもJevへ構造化shapeだけ送り、`boringness`を0..1で取得します。`Math.random() < boringness × boringBlockRate`ならPiの`tool_call` preflightでblockし、モデルへ別の介入を選ぶよう理由を返します。実引数の文字列内容はJevへ送りません。
- Jev失敗・timeout・キーなしではtool callをblockせず、既存heuristicも継続。別LLM失敗はauditに明示し、`drive` whisperへfallback。固定文をLLM生成と偽りません。
- whisperは `context` が返すコピーにだけ追加。`sendMessage` / `sendUserMessage` / 永続custom messageは使いません。Pi内部では`role: custom`、wire上はPiの仕様でuser roleに変換されますが明確な内部刺激ラベルが付きます。
- 永続化するのはdrive state、fingerprint、decision、whisperの種類/hash、API使用token数とattention履歴。**whisper原文は保存しません**。モデルが自分の発言や成果物で引用した内容までは消去しません。delusion自体はpersistent設定です。
- `unharnessed:audit` / `unharnessed:whisper` のPi event busで観察可能。通常は原文非保存ですが、比較scriptは明示的に原文とprovider入力を記録するため、出力はprivate扱いです。
- 世代番号とAbortSignalでoff/終了/branch変更後の遅延結果を破棄。state snapshotはdeep copyで、過去のbranchの状態を後から書き換えません。

## 実モデル比較

```bash
# 上のdocker runと同じ隔離オプションを使い、別名と新品volumeを指定。
docker run --name unharnessed-compare \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=128 --memory=2g --cpus=2 \
  --tmpfs /tmp:rw,nosuid,size=256m \
  --tmpfs /home/node:rw,nosuid,size=64m,uid=1000,gid=1000 \
  --env-file .local/lab.env \
  -e UNHARNESSED_CONFIG=/opt/unharnessed/examples/intense.json \
  --mount type=volume,source=unharnessed-compare,target=/lab \
  unharnessed:dev --compare
docker cp unharnessed-compare:/lab ./artifacts/comparison
```

同じユーザーprompt・同じ主モデルで通常PiとUnharnessedを順に実行。実LLM thought、実Jev、attention遷移、tool errorなし、ephemeral非保存をassertします。各runは14ターン/240秒で中断し、無限に動かしません。既存成果物による比較汚染を避けるため、空でないvolumeは拒否します。生成物の質は非決定的なので、失敗ならtraceを見てください。

検証済みの比較と失敗からの修正は [`docs/verification.md`](docs/verification.md)。これは単発の挙動観察であり、創造性の統計的benchmarkではありません。

## 後から回収する

Unharnessedに修復義務を戻さず、成果物・diff・session・`salvage`出力を別の普通のcoding agentへ渡してください。「架空priorは事実ではない。面白い発見だけを要約し、必要ならrepair / salvage / reimplementする」と依頼できます。このextensionに承認agentや自動修復loopはありません。
