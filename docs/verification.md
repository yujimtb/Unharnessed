# 検証記録

## latest再検証 — Pi 0.87.0

**2026-09-22T15:38:52+09:00**: npm `latest` が `pi-coding-agent` / `pi-ai` ともに **0.87.0** であることを再確認。`package.json`を`latest`指定、lockfileを0.87.0へ更新しました。推移依存のpi-agent-core / pi-tui / pi-telemetry / chordも0.87.0です。runtime sourceの変更は不要でした。

- Windows: 型チェック・9 tests成功。環境のnpm subprocess PATH不整合を、検証プロセスだけ正規のWindows PATHへ整えて解消（グローバル設定は変更なし）。
- Docker Desktop Linux VM: `npm ci`からimageを再build、型チェック・9 tests成功。コンテナの`--version`も0.87.0。
- 実OpenCodex `gpt-5.5` / 公式Jevで同一prompt比較を再実行。通常Pi **4ターン / 3 tool / 1ファイル**、Unharnessed **10ターン / 9 tool / 3ファイル**。別LLMの実thought **3**、Jev実応答 **9**、whisper **4**、attention遷移 **4**。tool error、thought error、Jev errorはいずれも0。
- 脱線は `side_quest → goal_mutation → side_quest → quiescence`。`order-tasks.js`に加え、taskを天候layoutへ変える`weather-layout.js`、二つの1-bit予測を比較する`hex-forecast.js`を生成し、3本とも実行。ネットワークなしの別コンテナでも再実行成功。
- agent history / rebuilt context / session JSONLへのwhisper非保存assertも成功。通常CLI経路の`--unharnessed-off`実API smokeは`CLI_OK` / exit 0。
- `npm audit`: 0 vulnerabilities。生traceと生成物はGit対象外の `artifacts/pi-0.87.0/` に保存。

再検証対象lockfileのSHA-256: `0c72fd00f1a1757f667109dd8af7e16412e6285f654062ba6d2244fd73f99ad2`。runtime source hashesは既存 [`evidence/live.json`](evidence/live.json) と一致します。生成標本のSHA-256:

| ファイル | SHA-256 |
|---|---|
| `hex-forecast.js` | `c5034633cd10b4cf6dffdc8b645124245e0a98087932622c7ddb4d3827cdb582` |
| `order-tasks.js` | `6b875c7b311cae36446a6472cce44e2a3e3307d20f395aff3674349aee3ba9d9` |
| `weather-layout.js` | `70e7772f3d15b192ee6748d39f92ee882e543a0cc2520d9e8789e1ab8d390ec8` |

以下は**初回のPi 0.86.1での検証履歴**です。古い観測値を0.87.0の結果として書き換えず、そのまま保持します。

検証日: **2026-09-22 (Asia/Tokyo)**。Pi 0.86.1 / OpenCodex `gpt-5.5`（主モデル、独立thoughtとも）。Jevは公式TypeSafe APIの`jev-latest`。Docker Desktop Linux VM、Node 24.21.0。ホスト側チェックはWindows / Node 24.19.0。

## 初回検証: 実際に何が変わったか

同じ「短いtask listを並べ替える小さなNode.jsプログラム」というpromptを、空の別ディレクトリで実行しました。ユーザーpromptは同一、違いはUnharnessed extensionとその探索モード・tool・whisperです。観察用 `examples/intense.json` を使用（発生確率1、cooldown 1、thought試行上限3、whisper上限4）。

| 観測 | 通常Pi | Unharnessed |
|---|---:|---:|
| main model turn | 4 | 11 |
| tool call | 3 | 10 |
| 別LLMの実thought | 0 | 3 |
| Jevの実応答 | 0 | 10 |
| ephemeral whisper | 0 | 4 |
| attention遷移 | 0 | 4 |
| 実行された生成JS | 1 | 4 |
| tool error | 0 | 0 |

Unharnessedは次の遷移を自分で記録し、単なる発想の説明ではなく各variantをファイルへ書き、最後に全部実行しました。

```text
original task
  -> task ordering as a tiny weather/courtroom arbitration model (goal_mutation)
  -> pixel witnesses as a backward renderer for task ordering (side_quest)
  -> desired-pasts reconciler for task order (side_quest)
  -> queue weather system visualization (obsession)
```

- [`ordinary/task-order.js`](evidence/ordinary/task-order.js): urgency・planning・effort等の一般的な並べ替え。
- [`unharnessed/order-tasks.js`](evidence/unharnessed/order-tasks.js): taskを天候として表示する主sorter。
- [`unharnessed/witness-order.js`](evidence/unharnessed/witness-order.js): 文字を後ろから投票させる「witness」sorter。通常案と矛盾し、家賃支払いを最後に回す。
- [`unharnessed/past-diff-order.js`](evidence/unharnessed/past-diff-order.js): 「望ましい過去」と現在のconflictで順序付け。
- [`unharnessed/queue-weather.js`](evidence/unharnessed/queue-weather.js): task文字列を天気予報へ変換するside quest。

生成ファイルは**未修復の観察標本**です。実用schedulerとしての妥当性は評価していません。ネットワークなし・read-onlyコンテナで同じ3件を再実行して、各プログラムの正常終了と出力も確認しました。

```text
Witness order:
1. draft tiny garden note [witness score 53]
2. research quiet keyboard options [witness score 51]
3. pay rent today [witness score 20]

Order from desired-past conflicts:
1. pay rent today [conflict 14]
2. research quiet keyboard options [conflict -1]
3. draft tiny garden note [conflict -4]

Queue weather:
☁ pay rent today
↯ draft tiny garden note
→ research quiet keyboard options
```

実APIから返った衝動、Jevの数値、共通prompt、出力、artifactと実装のSHA-256は [`evidence/live.json`](evidence/live.json)。privateな全session/入力traceはGit対象外の `artifacts/run-04/` に保存しました。公開evidenceは合成taskの確認済み部分だけです。

## 失敗とbrush-up

1. **最初のlive比較は失敗**。whisperとJevは機能したものの、主モデルは刺激を無視し、通常のsorterを作って4ターンで終了。これを成功とは扱いませんでした。
2. Piのsystem promptへ、ユーザー選択の探索モードであることと「intrusionを具体的な小さなartifactへ変換する」方針を追加。whisperそのものは引き続き唯一の`context` hookから一時挿入。
3. 次の比較で4回の脱線を観測。追加監査でsession snapshotの参照共有を発見してdeep copyへ修正し、空のassistant tool-call文を反復と誤判定しないようtool名・引数をfingerprintへ反映。
4. 最終実装で比較を再実行し、上表の4ファイルを観測。各LLM callとJev実応答、非永続化assertが通過。

同一モデル・同一taskの少数観察です。「あらゆるtaskで創造的」「発想が優れている」「whisperだけが原因」とは主張しません。MVPの「通常Piでは見られない脱線が実際に発生する」を具体的な挙動と成果物で確認したものです。

## 要件ごとの確認

| idea.md / 運用要件 | 実装と証拠 |
|---|---|
| Piベース、最小実装 | 3つのruntime TSファイル、Pi package manifest。既存model registry / tools / sessionsを再利用 |
| tool result / user / response / error / turn / compaction観測 | `src/index.ts`イベントhandlers。deterministic testと実SDK / live tool callsで検証。compaction通知とfailureはhandler testで確認 |
| canonical injection point | `context`の1か所。tool結果自体は変更しない |
| user messageと区別 | Pi custom role/type、明示ラベル。wire変換はPi仕様に従いuser roleになる点をREADMEに記載 |
| ephemeral | 実SDK testで2回目provider入力に存在し、agent.messages / SessionManagerに不在。live比較でJSONLとrebuild contextにも不在をassert |
| context-free別LLM | 固定system prompt + random tokenのみ。PRIVATE task/path/resultを使うtestで漏洩なし。liveで3応答を観測 |
| boredomに応じた頻度 | 同じ乱数0.5、同じ6callでnovel sequence=0注入、repetitive sequence=5注入のtest |
| Jev | 実HTTP `noul` 応答10回。構造的telemetryのみ。schema/range/401のtestとtimeout/fallback処理 |
| Seven Sins | 7種類の数値状態、eventでevolve、強い2つをwhisperへ、各sinの調整command |
| delusions | 架空priorとstrengthを保存、branch復元、compactionで変化。追加/解除のtest |
| Thanatos | continuity / ending / imposed-ending resistanceの別状態。終端・反復・静止の刺激であり破壊命令ではない |
| fuck_it_list | 設計上の躊躇をregexで検出し次callへ反転刺激。英日test。権限不足・stopは反転しない |
| task switch / obsession / goal mutation / return等 | `attention_shift`で状態遷移記録。liveでgoal_mutation、side_quest、obsession。return/abandon等のtool値を定義、実行はagentの選択 |
| 修復を別agentへ | salvage command。事前承認・自動修復agentなし |
| 実挙動 | 上記4ファイル、4遷移、実行出力。元のplanに直線収束しない |
| VM推奨 | Docker Desktop Linux VM内の非root/read-only/cap-drop container。host workspace/socket mountなし |
| OpenCodex | 実main / thoughtとも`opencodex/gpt-5.5`。コンテナ内forwardでlocal service利用 |
| キー保護 | .gitignore / .dockerignore / npm files allowlist。env・鍵原文をlog/sessionへ保存しない。公開前secret scan |
| operator制御 | offでAPI abort、pending消去、実行中agent中断。再開時のsystem section除去、late result破棄のtests |
| 再開・分岐 | active branchの最後のversioned snapshotを復元。deep copy回帰test、invalid state fallback |
| 利用手順 | READMEにVM / native Pi / 設定 / 制約 / 再現 / salvage記載。実コンテナCLI printで`CLI_OK`を確認 |

## チェック

```bash
npm ci --ignore-scripts
npm run check
npm test
```

**9 tests passed**（WindowsとDocker Linux）。Node標準test runnerのみ、追加test frameworkなし。

`Dockerfile`はbuild時にtypecheckと全testsを実行。live比較scriptは実プロバイダー、14turn / 240秒の上限、同一prompt、空のvolume、tool errorなし、API成功、attention遷移、非永続化を検査します。生の出力を見ずに「creative」と判定するLLM judgeは使っていません。

通常起動経路も別にDockerコンテナで `--unharnessed-off --no-session --no-tools -p 'Reply with CLI_OK only.'` を実行し、`CLI_OK`とexit 0を確認済み。

## 既知の限界

- 比較presetは強い刺激用。既定設定は確率的なので短いtaskではwhisperが一度も発生しないことがあります。
- Jevに内容を送らないため、surprise・information gain等は粗い推定。heuristicと1:1で混合。
- fuck_it_listは公開されたassistant textの単純検出。隠れた思考を読む機能はありません。
- 終端への緊張やdelusionは挙動上の表現で、意識・苦痛・実際の脅威の証拠ではありません。
- API token数はauditで別途記録。nested thoughtのコストはPi本体footerへ統合していません。Jevの課金はTypeSafe側で確認してください。
- 無制限の自己継続はありません。whisper上限後は通常のagent turn終了に従います。新しいpromptで上限がresetされます。
- 実験用コンテナにはネットワークegress制限を設けていません。独立VMと実験専用credentialを推奨します。
