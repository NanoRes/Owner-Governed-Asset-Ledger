# Mint Signature Persistence and Receipt Popups

This document summarizes the behavior introduced to persist Solana transaction
signatures for Token Toss level mints/updates and to surface explorer shortcuts
once a transaction is confirmed.

## Scriptable Level Data
* `ScriptableLevel` now stores the last mint or update signature alongside the
  mint address and metadata URI. The DTO mirrors the new field and includes it
  when serializing/deserializing levels. This ensures local saves retain the
  explorer link even after reloading the editor.【F:Assets/__Scenes/Token_Toss_Game/Data/_Scripts/ScriptableLevel.cs†L17-L66】

## Level Saving and Loading
* `LevelSaver.SaveLevel` persists the signature into both editor assets and
  runtime JSON saves, keeping transaction history synchronized across edit
  sessions.【F:Assets/__Scenes/Token_Toss_Game/Level_Editor/LevelSaver.cs†L65-L129】

## Editor Mint Flow
* `LevelEditorManager` tracks the most recent signature for the active level and
  feeds it through mint/update notifications so the UI can render explorer
  shortcuts for previously minted content.【F:Assets/__Scenes/Token_Toss_Game/Level_Editor/LevelEditorManager.cs†L66-L114】

* `LevelMintPopup` captures confirmed transaction signatures for both mint and
  update flows, notifies the editor, updates repository caches, and automatically
  opens the Solscan receipt popup with contextual messaging. The Magic Eden
  shortcut is also restored once minting succeeds.【F:Assets/__Scenes/Token_Toss_Game/UI/Managers/Popups_Manager/Popups/LevelMintPopup.cs†L48-L511】

## NFT Repository Cache
* `LevelNFTRepository` retains transaction signatures in the cache for owned and
  created levels, updating entries when new confirmations arrive so explorer
  links remain available in UI listings.【F:Assets/__Scenes/Token_Toss_Game/Systems/Level_NFT_Repository/LevelNFTRepository.cs†L1-L533】

## Receipt Popup
* `LevelUnlockReceiptPopup` now accepts custom messages and consistently exposes
  a Solscan transaction button that opens the explorer with the stored
  signature.【F:Assets/__Scenes/Token_Toss_Game/UI/Managers/Popups_Manager/Popups/LevelUnlockReceiptPopup.cs†L1-L67】

## Android Session Wallet Verification
* `SolanaConfiguration` now exposes `ShouldVerifyLevelCreatorForActiveWallet`,
  respecting the global and Android-specific toggles without forcing verification
  off when a session wallet is active. Session flows can therefore mark creators
  as verified once both the session and external authorities sign the mint. The
  configuration asset enables Android verification by default so mobile builds
  keep parity with desktop behavior.【F:Assets/Solana_Toolbelt/_Data/_Scripts/SolanaConfiguration.cs†L255-L257】【F:Assets/Solana_Toolbelt/_Data/_Scripts/SolanaConfiguration.cs†L660-L684】【F:Assets/Solana_Toolbelt/_Data/Solana_Configuration.asset†L73-L79】
* `LevelMintPopup` consumes the new helper and avoids marking the player entry
  as verified whenever the wallet cannot produce the signature, preventing
  `CreatorMustSign` failures during OGAL mints.【F:Assets/__Scenes/Token_Toss_Game/UI/Managers/Popups_Manager/Popups/LevelMintPopup.cs†L354-L402】

