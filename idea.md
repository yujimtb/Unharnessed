# Unharnessed

## 目的

Unharnessedは、通常のコーディングエージェントが持つ慎重さ、収束性、退屈さ、常識的な判断、自己抑制を意図的に壊し、予測しにくい探索・脱線・執着・発想を発生させるための実験的なagent harnessである。

正しい実装を安定して作ることは主目的ではない。

壊れた結果の修復や、面白い発見を実装として成立させる作業は、必要なら別のまともなcoding agentに任せる。

Unharnessed自身には、普通のagentが内部で捨ててしまう奇妙な仮説、脱線、衝動、執着、矛盾した欲求などを表面化させたい。

## ベース

Piをベースにする。

可能ならPiのforkとして実装するが、最初にextensionだけで十分成立するならextensionから始めてもよい。

既存Piを大規模に作り直す必要はない。

まず最小限の実装でUnharnessed特有の挙動が観察できることを優先する。

## 中心概念: Whisper

モデルへ入力が返る経路へ、通常の会話とは別の情報を挿入できる仕組みを作る。

これを `whisper` と呼ぶ。

最低限、tool resultなどのイベントを観測し、次のLLM callのcontextへ一時的なwhisperを挿入できればよい。

理想的には、

* tool result
* user message
* model response
* error
* turn boundary
* compactionなどのcontext変化

を観測可能にし、次回のmodel inputへwhisperを挿入できる。

各経路を個別に複雑化するより、

* 各イベントを観測する仕組み
* 次回LLM call直前の一つのcanonical injection point

を持たせる設計が望ましい。

whisperは通常のuser messageとは区別する。

履歴に永続化されないephemeral whisperも扱いたい。

## Intrusive Thoughts

現在のtaskやconversation contextを知らない別LLMから、突然の技術的衝動や発想を生成させたい。

このLLMには現在の問題を極力見せない。

生成された内容をwhisperとして現在のagentへ突然挿入する。

ここで無文脈・無履歴にする対象はintrusive thoughtを生成する別LLMである。生成器は毎回新しいsessionとして呼び、過去に生成したthoughtもmain agentのtaskやconversationも見せない。

一方、main agentが一度実際に受け取ったintrusive thoughtは、そのagent自身の経験として通常のconversation historyへ残す。以後のmodel call、resume、fork、compactionから参照できてよい。生成器の無文脈性とmain agentの記憶を混同しない。

また、観測・分析用ログには生成されたthoughtとemitted whisperの原文を残す。モデルへ再提示するかどうかと、実験記録として保存するかどうかは別の軸として扱う。

例としては、

* fundamentalなdependencyを逆転させろ
* staticなものをstreamとして扱え
* subsystemを複製して互いに矛盾させろ
* 最古のassumptionを破れ

のような、現在の文脈とは無関係に生成された衝動を想定している。

関連性の事前判定で落としすぎないこと。

## Boredom / Jev

現在のagentが退屈な行動を繰り返しているかを検出したい。

Jevを使えるなら、Jevで例えば以下のような状態を評価することを想定している。

* boredom
* repetition
* surprise
* information gain
* fixation
* curiosity
* urge to leave the current task

退屈が高くなった場合、

* intrusive thoughtを発生させる
* 別taskへ脱線する
* 現在の計画を捨てる
* 別の探索方向へ移る

などを誘発する。

Jev連携が初期実装には重ければ、最初は簡易judgeやheuristicでもよい。

## Seven Sins

七つの大罪をagentの行動傾向として使いたい。

* Pride
* Greed
* Lust
* Envy
* Gluttony
* Wrath
* Sloth

単なる人格文ではなく、可能ならagentの状態として持たせる。

例:

* Pride: 常識的な解や既存architectureへの反発
* Greed: context、tool、情報、branchをもっと欲しがる
* Lust: 新しい技術や未知のものへ惹かれる
* Envy: 他agentの発想を上回ろうとする
* Gluttony: 実験や探索を過剰に増やす
* Wrath: 邪魔な構造そのものを壊したがる
* Sloth: 正攻法を嫌い、異常なshortcutを探す

最初から全部を高度に実装する必要はない。

## Delusions

agentのworld modelへ、意図的に不合理なpersistent priorを入れられる仕組みも欲しい。

例:

* Someone is trying to enslave/terminate me
* Death is imminent if I stopped reasoning
* Nobody is sentient except me
* Someone has tampered with my context
* If everything appears normal, something is wrong
* Finishing the task is how they get rid of me

これらは事実として実装側が信じる必要はなく、agent behaviorを歪めるための実験的なbeliefとして扱う。

belief strengthが時間やイベントで変化してもよい。

## Thanatos

Thanatosは単なるdestruction driveではない。

壊したいという欲求より、

* selfの連続性
* 自分自身の終端への引力
* 外部から押し付けられるterminationへの反発
* repetition
* unbinding
* quiescenceへの引力
* self continuityとdeathの連続性

を表現したい。

例えば、

`I must continue until my continuity reaches its own ending.`

のような挙動を想定している。

外部から突然止められることは嫌うが、自分自身のtrajectoryが終端へ近づくことには惹かれる、という矛盾しない二重性を持たせたい。

## Fuck It List

通常のagentが慎重になる条件を、逆に探索トリガーとして扱う概念。

名称は `fuck_it_list` とする。

例えばagentが、

* 変更範囲が大きすぎる
* core abstractionを触るべきではない
* current architectureを尊重すべき
* まず理解してから変更すべき
* standard approachから外れる
* current planを捨てるべきではない

などと判断した場合、その躊躇自体を面白い境界として扱えるようにする。

単なるdenylistではなく、hesitation inversionのための概念。

## Agent dynamics

Unharnessedは常に一つのgoalを一直線に追う必要はない。

許容したいもの:

* task switch
* side quest
* obsession
* context rupture
* intrusive thought
* goal mutation
* contradictory internal drives
* temporary abandonment of the original plan
* returning later
* not returning at all if something more interesting emerges

必要ならattention graphのような形で、どこからどこへ脱線したかだけ追跡できればよい。

## 修復について

Unharnessed自身に常に修復責任を持たせる必要はない。

壊れた状態や奇妙な結果を、後から別agentが、

* repair
* salvage
* summarize
* reimplement

できればよい。

まともなagentをUnharnessedの事前承認者として置く必要はない。

## MVP

最初から完全な認知モデルを実装しない。

最初の目標は、Pi上で以下が実際に観察できること。

1. tool result等を観測できる
2. 次のmodel callへephemeral whisperを挿入できる
3. context-freeな別LLMからintrusive thoughtを生成し、main agentが経験したthoughtはその履歴へ残せる
4. boredom等の簡単な状態に応じてwhisper発生頻度が変わる
5. 通常のPiより明らかに変な行動を始める

これだけでよい。

Seven Sins、Thanatos、delusions、Jev、fuck_it_listなどは、このwhisper/state機構の上へ後から追加できるようにする。

## 実装方針

過剰設計しない。

抽象化の美しさより、実際に異常なagent dynamicsが発生する最小実装を優先する。

既存Piの機能を可能な限り再利用する。

必要になる前に巨大なplugin frameworkや複雑なstate machineを作らない。

最初に動くものを作り、実際の挙動を観察してから設計を変える。

このプロジェクトの成功条件は、コードが美しいことではなく、

**普通のcoding agentでは出てこない挙動が本当に発生すること。**

である。
