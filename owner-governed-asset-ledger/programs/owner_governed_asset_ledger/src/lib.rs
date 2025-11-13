use anchor_lang::{
    prelude::*,
    solana_program::{
        program::invoke_signed, pubkey::Pubkey as SolanaProgramPubkey, system_instruction, sysvar,
    },
    Discriminator,
};
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token::{self, InitializeMint2, Mint, MintTo, Token, TokenAccount},
};
use borsh::BorshDeserialize;
use bytemuck::from_bytes_mut;
use mpl_token_metadata::{
    accounts::{MasterEdition as MetadataMasterEdition, Metadata as MetadataAccount},
    instructions::{
        CreateMasterEditionV3Cpi, CreateMasterEditionV3CpiAccounts,
        CreateMasterEditionV3InstructionArgs, CreateMetadataAccountV3Cpi,
        CreateMetadataAccountV3CpiAccounts, CreateMetadataAccountV3InstructionArgs,
        UpdateMetadataAccountV2Cpi, UpdateMetadataAccountV2CpiAccounts,
        UpdateMetadataAccountV2InstructionArgs, VerifyCollectionCpi, VerifyCollectionCpiAccounts,
        VerifySizedCollectionItemCpi, VerifySizedCollectionItemCpiAccounts,
    },
    types::{
        Collection, CollectionDetails, Creator as MetadataCreator, Data, DataV2,
        Key as MetadataKey, ProgrammableConfig, TokenStandard, Uses,
    },
    MAX_CREATOR_LIMIT, MAX_NAME_LENGTH, MAX_SYMBOL_LENGTH,
    MAX_URI_LENGTH as METADATA_MAX_URI_LENGTH,
};
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::state::{TlvState, TlvStateBorrowed};
use std::collections::HashSet;

declare_id!("GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx");

const CONFIG_SEED: &[u8] = b"config";
const AUTH_SEED: &[u8] = b"auth";
const MANIFEST_SEED: &[u8] = b"object_manifest";
const MINT_SEED: &[u8] = b"object_mint";
/// Update this array with any wallet addresses that are permitted to deploy the
/// program or run the `initialize` instruction. For example:
/// `const ALLOWED_DEPLOYERS: [Pubkey; 1] = [pubkey!("DeployerPubkey...")];`
const ALLOWED_DEPLOYERS: [Pubkey; 1] = [pubkey!("GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx")];
/// The manifest URI is stored directly on the [`ObjectManifest`] account.
///
/// A smaller allocation keeps the account (and the generated account
/// validation code) within Solana's stack limits while still supporting
/// typical HTTPS or IPFS style URIs.
const MAX_URI_LENGTH: usize = 128;
const MANIFEST_PADDING: usize = 8;
const CREATOR_TOTAL_SHARE: u16 = 100;

fn mpl_program_id() -> Pubkey {
    Pubkey::new_from_array(mpl_token_metadata::ID.to_bytes())
}

fn to_solana_pubkey(key: &Pubkey) -> SolanaProgramPubkey {
    SolanaProgramPubkey::new_from_array(key.to_bytes())
}

fn from_solana_pubkey(key: &SolanaProgramPubkey) -> Pubkey {
    Pubkey::new_from_array(key.to_bytes())
}

fn metadata_account_base_len(account_data: &[u8]) -> Option<usize> {
    let mut cursor = account_data;

    MetadataKey::deserialize(&mut cursor).ok()?;
    Pubkey::deserialize(&mut cursor).ok()?;
    Pubkey::deserialize(&mut cursor).ok()?;
    Data::deserialize(&mut cursor).ok()?;
    bool::deserialize(&mut cursor).ok()?;
    bool::deserialize(&mut cursor).ok()?;
    Option::<u8>::deserialize(&mut cursor).ok()?;
    Option::<TokenStandard>::deserialize(&mut cursor).ok()?;
    Option::<Collection>::deserialize(&mut cursor).ok()?;
    Option::<Uses>::deserialize(&mut cursor).ok()?;
    fn consume_optional<'a, T: BorshDeserialize>(cursor: &mut &'a [u8]) -> bool {
        if cursor.is_empty() {
            return false;
        }

        match cursor[0] {
            0 => {
                *cursor = &cursor[1..];
                true
            }
            1 => {
                let before = *cursor;
                let mut rest = &cursor[1..];
                match T::deserialize(&mut rest) {
                    Ok(_) => {
                        *cursor = rest;
                        true
                    }
                    Err(_) => {
                        #[cfg(test)]
                        eprintln!(
                            "consume_optional failed for {} (first byte {}, len {})",
                            std::any::type_name::<T>(),
                            cursor[0],
                            cursor.len()
                        );
                        *cursor = before;
                        false
                    }
                }
            }
            _ => false,
        }
    }

    let collection_details_cursor = cursor;
    if !consume_optional::<CollectionDetails>(&mut cursor) {
        return Some(
            account_data
                .len()
                .saturating_sub(collection_details_cursor.len()),
        );
    }

    let programmable_config_cursor = cursor;
    if !consume_optional::<ProgrammableConfig>(&mut cursor) {
        return Some(
            account_data
                .len()
                .saturating_sub(programmable_config_cursor.len()),
        );
    }

    Some(account_data.len().saturating_sub(cursor.len()))
}

#[derive(Clone, Copy, SplDiscriminate)]
#[discriminator_hash_input("collection_details")]
struct CollectionDetailsTag;

fn read_collection_details_from_tlv(account_data: &[u8]) -> Option<CollectionDetails> {
    let base_len = metadata_account_base_len(account_data)?;
    if base_len >= account_data.len() {
        return None;
    }

    let tlv_bytes = &account_data[base_len..];
    let state = TlvStateBorrowed::unpack(tlv_bytes).ok()?;
    let mut value = state.get_first_bytes::<CollectionDetailsTag>().ok()?;
    CollectionDetails::deserialize(&mut value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::BorshSerialize;

    #[test]
    fn metadata_base_len_handles_missing_optional_tail() {
        let metadata = MetadataAccount {
            key: MetadataKey::MetadataV1,
            update_authority: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            name: "Collection".into(),
            symbol: "COLL".into(),
            uri: "https://example.com/collection.json".into(),
            seller_fee_basis_points: 0,
            creators: None,
            primary_sale_happened: false,
            is_mutable: true,
            edition_nonce: None,
            token_standard: None,
            collection: None,
            uses: None,
            collection_details: None,
            programmable_config: None,
        };

        let mut data = Vec::new();
        metadata.serialize(&mut data).unwrap();

        let base_len = metadata_account_base_len(&data).unwrap();
        assert_eq!(base_len, data.len());
        assert!(read_collection_details_from_tlv(&data).is_none());
    }
}

#[program]
pub mod owner_governed_asset_ledger {
    use super::*;

    /// Initializes a configuration instance under the provided namespace.
    ///
    /// Passing a distinct namespace allows the authority to operate multiple
    /// configurations concurrently or migrate to a new namespace without
    /// redeploying the program. To migrate, derive the desired namespace,
    /// invoke [`initialize`] (or [`migrate_config_namespace`]) with the new
    /// namespace, and point subsequent instructions at the new config PDA.
    pub fn initialize(ctx: Context<Initialize>, namespace: Pubkey) -> Result<()> {
        let config_bump = ctx.bumps.config;
        let auth_bump = ctx.bumps.auth;

        let authority_key = ctx.accounts.authority.key();
        let payer_key = ctx.accounts.payer.key();
        require!(
            authority_key == payer_key || is_allowed_deployer(&authority_key),
            ErrorCode::UnauthorizedDeployer
        );

        let config = &mut ctx.accounts.config;
        config.authority = authority_key;
        config.config_bump = config_bump;
        config.auth_bump = auth_bump;
        config.object_count = 0;
        config.namespace = namespace;
        config.paused = false;

        let auth = &mut ctx.accounts.auth;
        auth.config = config.key();
        auth.bump = auth_bump;

        Ok(())
    }

    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = new_authority;

        Ok(())
    }

    pub fn rotate_collection_authority(
        ctx: Context<RotateCollectionAuthority>,
        new_update_authority: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.token_metadata_program.key(),
            mpl_program_id(),
            ErrorCode::InvalidTokenMetadataProgram
        );

        let config_key = ctx.accounts.config.key();
        let collection_mint_key = ctx.accounts.collection_mint.key();
        let mpl_collection_mint_key = to_solana_pubkey(&collection_mint_key);
        let (expected_collection_metadata_mpl, _) =
            MetadataAccount::find_pda(&mpl_collection_mint_key);
        let expected_collection_metadata = from_solana_pubkey(&expected_collection_metadata_mpl);

        require_keys_eq!(
            ctx.accounts.collection_metadata.key(),
            expected_collection_metadata,
            ErrorCode::InvalidCollectionMetadataAccount
        );

        let metadata_program_info = ctx.accounts.token_metadata_program.to_account_info();
        let collection_metadata_info = ctx.accounts.collection_metadata.to_account_info();
        let auth_info = ctx.accounts.auth.to_account_info();

        let auth_bump = ctx.accounts.auth.bump;
        let signer_seeds: &[&[u8]] = &[AUTH_SEED, config_key.as_ref(), &[auth_bump]];

        let args = UpdateMetadataAccountV2InstructionArgs {
            data: None,
            new_update_authority: Some(to_solana_pubkey(&new_update_authority)),
            primary_sale_happened: None,
            is_mutable: None,
        };

        UpdateMetadataAccountV2Cpi::new(
            &metadata_program_info,
            UpdateMetadataAccountV2CpiAccounts {
                metadata: &collection_metadata_info,
                update_authority: &auth_info,
            },
            args,
        )
        .invoke_signed(&[signer_seeds])
        .map_err(anchor_lang::error::Error::from)?;

        Ok(())
    }

    pub fn mint_object_nft<'info>(
        ctx: Context<'_, '_, 'info, 'info, MintObjectNft<'info>>,
        object_id: u64,
        manifest_uri: String,
        manifest_hash: [u8; 32],
        metadata_name: String,
        metadata_symbol: String,
        seller_fee_basis_points: u16,
        creators: Vec<CreatorInput>,
    ) -> Result<()> {
        let metadata_accounts = ctx.accounts.metadata.clone();
        let (
            collection_metadata_account,
            collection_master_edition_account,
            rent_sysvar_account,
            instructions_sysvar_account,
            creator_remaining_accounts,
        ) = metadata_remaining_accounts(ctx.remaining_accounts)?;
        require!(
            collection_metadata_account.is_writable,
            ErrorCode::InvalidCollectionMetadataAccount
        );
        require!(
            collection_master_edition_account.is_writable,
            ErrorCode::InvalidCollectionMasterEditionAccount
        );

        require!(!ctx.accounts.base.config.paused, ErrorCode::MintingPaused);

        let config_key = ctx.accounts.base.config.key();
        let payer = &ctx.accounts.base.payer;
        let payer_key = payer.key();
        let payer_account_info = payer.to_account_info();
        let system_program_account_info = ctx.accounts.base.system_program.to_account_info();
        let token_program_account_info = ctx.accounts.base.token_program.to_account_info();
        let associated_token_program_account_info =
            ctx.accounts.base.associated_token_program.to_account_info();
        let auth_account_info = ctx.accounts.base.auth.to_account_info();
        let recipient_account_info = ctx.accounts.base.recipient.to_account_info();

        let object_id_bytes = object_id.to_le_bytes();
        let manifest_key = ctx.accounts.base.object_manifest.key();
        let (expected_manifest_key, manifest_bump) = Pubkey::find_program_address(
            &[MANIFEST_SEED, config_key.as_ref(), &object_id_bytes],
            ctx.program_id,
        );
        require_keys_eq!(
            manifest_key,
            expected_manifest_key,
            ErrorCode::InvalidManifestAccount
        );

        let manifest_info = ctx.accounts.base.object_manifest.to_account_info();
        ensure_object_manifest_account(
            &manifest_info,
            &payer_account_info,
            &system_program_account_info,
            ctx.program_id,
            &[
                MANIFEST_SEED,
                config_key.as_ref(),
                &object_id_bytes,
                &[manifest_bump],
            ],
        )?;

        let mint_key = ctx.accounts.base.object_mint.key();
        let (expected_mint_key, object_mint_bump) =
            Pubkey::find_program_address(&[MINT_SEED, manifest_key.as_ref()], ctx.program_id);
        require_keys_eq!(
            mint_key,
            expected_mint_key,
            ErrorCode::InvalidObjectMintAccount
        );

        require_keys_eq!(
            rent_sysvar_account.key(),
            sysvar::rent::id(),
            ErrorCode::InvalidRentSysvar
        );
        if let Some(ref account) = instructions_sysvar_account {
            require_keys_eq!(
                account.key(),
                sysvar::instructions::id(),
                ErrorCode::InvalidInstructionsSysvar
            );
        }

        let object_mint_info = ctx.accounts.base.object_mint.to_account_info();
        ensure_object_mint_account(
            &object_mint_info,
            &payer_account_info,
            &system_program_account_info,
            &token_program_account_info,
            &[MINT_SEED, manifest_key.as_ref(), &[object_mint_bump]],
            &auth_account_info,
        )?;

        let expected_recipient_ata = associated_token::get_associated_token_address(
            &ctx.accounts.base.recipient.key(),
            &mint_key,
        );
        require_keys_eq!(
            ctx.accounts.base.recipient_token_account.key(),
            expected_recipient_ata,
            ErrorCode::InvalidRecipientTokenAccount
        );

        let recipient_token_account_info =
            ctx.accounts.base.recipient_token_account.to_account_info();
        ensure_recipient_token_account(
            &recipient_token_account_info,
            &recipient_account_info,
            &payer_account_info,
            &system_program_account_info,
            &token_program_account_info,
            &associated_token_program_account_info,
            &object_mint_info,
        )?;

        let mut increment_object_count = false;
        let was_minted;
        let stored_manifest_uri: String;
        let manifest_creator: Pubkey;
        {
            let mut data = manifest_info.try_borrow_mut_data()?;
            require!(
                data.len() >= ObjectManifest::LEN,
                ErrorCode::ManifestAccountTooSmall
            );
            let (disc_bytes, rest) = data.split_at_mut(8);
            if disc_bytes != ObjectManifest::discriminator() {
                disc_bytes.copy_from_slice(&ObjectManifest::discriminator());
            }
            let manifest_slice = &mut rest[..core::mem::size_of::<ObjectManifest>()];
            let manifest = from_bytes_mut::<ObjectManifest>(manifest_slice);

            was_minted = manifest.minted();

            if !manifest.initialized() {
                require!(manifest_uri.len() <= MAX_URI_LENGTH, ErrorCode::UriTooLong);
                require!(
                    manifest_uri.len() <= METADATA_MAX_URI_LENGTH,
                    ErrorCode::UriTooLong
                );

                manifest.config = config_key;
                manifest.object_id = object_id;
                manifest.mint = mint_key;
                manifest.bump = manifest_bump;
                manifest.mint_bump = object_mint_bump;
                manifest.set_is_active(true);
                manifest.set_initialized(true);
                manifest.set_minted(false);
                manifest.manifest_hash = manifest_hash;
                manifest.set_metadata_uri(&manifest_uri);
                manifest.creator = payer_key;
                increment_object_count = true;
            } else {
                require!(manifest.is_active(), ErrorCode::ObjectInactive);
                require!(manifest.object_id == object_id, ErrorCode::ObjectIdMismatch);
                require_keys_eq!(manifest.config, config_key, ErrorCode::InvalidConfig);
                require_keys_eq!(manifest.mint, mint_key, ErrorCode::MintMismatch);
                require!(
                    manifest.manifest_hash == manifest_hash,
                    ErrorCode::ManifestMismatch
                );
                require!(
                    manifest.metadata_uri_len() <= METADATA_MAX_URI_LENGTH,
                    ErrorCode::UriTooLong
                );
                if !manifest_uri.is_empty() {
                    require!(manifest_uri.len() <= MAX_URI_LENGTH, ErrorCode::UriTooLong);
                    require!(
                        manifest_uri.len() <= METADATA_MAX_URI_LENGTH,
                        ErrorCode::UriTooLong
                    );
                    require!(
                        manifest.metadata_uri_equals(&manifest_uri),
                        ErrorCode::ManifestMismatch
                    );
                }
            }

            manifest_creator = manifest.creator;
            stored_manifest_uri = manifest.metadata_uri_string();
        }

        if increment_object_count {
            ctx.accounts.base.config.object_count =
                ctx.accounts.base.config.object_count.saturating_add(1);
        }

        let is_first_mint = !was_minted;

        let recipient_mint = anchor_spl::token::accessor::mint(&recipient_token_account_info)?;
        require_keys_eq!(recipient_mint, mint_key, ErrorCode::MintMismatch);
        let recipient_owner =
            anchor_spl::token::accessor::authority(&recipient_token_account_info)?;
        require_keys_eq!(
            recipient_owner,
            ctx.accounts.base.recipient.key(),
            ErrorCode::RecipientMismatch
        );

        let signer_seeds: &[&[u8]] = &[
            AUTH_SEED,
            config_key.as_ref(),
            &[ctx.accounts.base.auth.bump],
        ];
        let auth_seeds = &[signer_seeds];

        let mut signer_keys: HashSet<Pubkey> = HashSet::new();
        signer_keys.insert(payer_key);
        for account in creator_remaining_accounts {
            if account.is_signer {
                signer_keys.insert(account.key());
            }
        }

        if is_first_mint {
            require!(
                metadata_name.as_bytes().len() <= MAX_NAME_LENGTH,
                ErrorCode::MetadataNameTooLong
            );
            require!(
                metadata_symbol.as_bytes().len() <= MAX_SYMBOL_LENGTH,
                ErrorCode::MetadataSymbolTooLong
            );
            require!(
                !creators.is_empty(),
                ErrorCode::InvalidCreatorShareDistribution
            );
            require!(
                creators.len() <= MAX_CREATOR_LIMIT,
                ErrorCode::TooManyCreators
            );
            require!(
                seller_fee_basis_points <= 10_000,
                ErrorCode::InvalidSellerFeeBasisPoints
            );
            require_keys_eq!(
                metadata_accounts.token_metadata_program.key(),
                mpl_program_id(),
                ErrorCode::InvalidTokenMetadataProgram
            );

            let total_shares: u16 = creators.iter().map(|creator| creator.share as u16).sum();
            require!(
                total_shares == CREATOR_TOTAL_SHARE,
                ErrorCode::InvalidCreatorShareDistribution
            );
            let includes_manifest_creator = creators
                .iter()
                .any(|creator| creator.address == manifest_creator);
            require!(includes_manifest_creator, ErrorCode::MissingManifestCreator);

            let mpl_mint_key = to_solana_pubkey(&mint_key);
            let (expected_metadata_mpl, _) = MetadataAccount::find_pda(&mpl_mint_key);
            let expected_metadata = from_solana_pubkey(&expected_metadata_mpl);
            require_keys_eq!(
                metadata_accounts.metadata.key(),
                expected_metadata,
                ErrorCode::InvalidMetadataAccount
            );
            let (expected_master_edition_mpl, _) = MetadataMasterEdition::find_pda(&mpl_mint_key);
            let expected_master_edition = from_solana_pubkey(&expected_master_edition_mpl);
            require_keys_eq!(
                metadata_accounts.master_edition.key(),
                expected_master_edition,
                ErrorCode::InvalidMasterEditionAccount
            );
            let collection_mint_key = metadata_accounts.collection_mint.key();
            let mpl_collection_mint_key = to_solana_pubkey(&collection_mint_key);
            let (expected_collection_metadata_mpl, _) =
                MetadataAccount::find_pda(&mpl_collection_mint_key);
            let expected_collection_metadata =
                from_solana_pubkey(&expected_collection_metadata_mpl);
            require_keys_eq!(
                collection_metadata_account.key(),
                expected_collection_metadata,
                ErrorCode::InvalidCollectionMetadataAccount
            );
            let (expected_collection_master_mpl, _) =
                MetadataMasterEdition::find_pda(&mpl_collection_mint_key);
            let expected_collection_master = from_solana_pubkey(&expected_collection_master_mpl);
            require_keys_eq!(
                collection_master_edition_account.key(),
                expected_collection_master,
                ErrorCode::InvalidCollectionMasterEditionAccount
            );

            let metadata_creators: Vec<MetadataCreator> = creators
                .iter()
                .map(|creator| -> Result<MetadataCreator> {
                    if creator.verified {
                        require!(
                            signer_keys.contains(&creator.address),
                            ErrorCode::CreatorMustSign
                        );
                    }
                    Ok(MetadataCreator {
                        address: to_solana_pubkey(&creator.address),
                        verified: creator.verified && signer_keys.contains(&creator.address),
                        share: creator.share,
                    })
                })
                .collect::<Result<Vec<_>>>()?;

            let data = DataV2 {
                name: metadata_name.clone(),
                symbol: metadata_symbol.clone(),
                uri: stored_manifest_uri.clone(),
                seller_fee_basis_points,
                creators: Some(metadata_creators),
                collection: Some(Collection {
                    key: to_solana_pubkey(&collection_mint_key),
                    verified: false,
                }),
                uses: None,
            };

            let metadata_program_info = metadata_accounts.token_metadata_program.to_account_info();
            let metadata_info = metadata_accounts.metadata.to_account_info();
            let mint_info = object_mint_info.clone();
            let auth_info = auth_account_info.clone();
            let payer_info = payer_account_info.clone();
            let system_program_info = system_program_account_info.clone();

            let mut creator_account_infos: Vec<(&AccountInfo<'info>, bool, bool)> =
                Vec::with_capacity(creator_remaining_accounts.len());
            for account in creator_remaining_accounts {
                creator_account_infos.push((account, account.is_signer, account.is_writable));
            }

            CreateMetadataAccountV3Cpi::new(
                &metadata_program_info,
                CreateMetadataAccountV3CpiAccounts {
                    metadata: &metadata_info,
                    mint: &mint_info,
                    mint_authority: &auth_info,
                    payer: &payer_info,
                    update_authority: (&auth_info, true),
                    system_program: &system_program_info,
                    rent: Some(&rent_sysvar_account),
                },
                CreateMetadataAccountV3InstructionArgs {
                    data,
                    is_mutable: true,
                    collection_details: Option::<CollectionDetails>::None,
                },
            )
            .invoke_signed_with_remaining_accounts(auth_seeds, &creator_account_infos)
            .map_err(anchor_lang::error::Error::from)?;
        }

        token::mint_to(
            CpiContext::new_with_signer(
                token_program_account_info.clone(),
                MintTo {
                    mint: object_mint_info.clone(),
                    to: recipient_token_account_info.clone(),
                    authority: auth_account_info.clone(),
                },
                auth_seeds,
            ),
            1,
        )?;

        if is_first_mint {
            let metadata_program_info = metadata_accounts.token_metadata_program.to_account_info();
            let edition_info = metadata_accounts.master_edition.to_account_info();
            let mint_info = object_mint_info.clone();
            let auth_info = auth_account_info.clone();
            let payer_info = payer_account_info.clone();
            let metadata_info = metadata_accounts.metadata.to_account_info();
            let token_program_info = token_program_account_info.clone();
            let system_program_info = system_program_account_info.clone();

            CreateMasterEditionV3Cpi::new(
                &metadata_program_info,
                CreateMasterEditionV3CpiAccounts {
                    edition: &edition_info,
                    mint: &mint_info,
                    update_authority: &auth_info,
                    mint_authority: &auth_info,
                    payer: &payer_info,
                    metadata: &metadata_info,
                    token_program: &token_program_info,
                    system_program: &system_program_info,
                    rent: Some(&rent_sysvar_account),
                },
                CreateMasterEditionV3InstructionArgs {
                    max_supply: Some(0),
                },
            )
            .invoke_signed(auth_seeds)
            .map_err(anchor_lang::error::Error::from)?;

            let metadata_program_info = metadata_accounts.token_metadata_program.to_account_info();
            let metadata_info = metadata_accounts.metadata.to_account_info();
            let auth_info = auth_account_info.clone();
            let payer_info = payer_account_info.clone();
            let collection_mint_info = metadata_accounts.collection_mint.to_account_info();

            let metadata_data = collection_metadata_account
                .try_borrow_data()
                .map_err(|_| Error::from(ErrorCode::InvalidCollectionMetadataAccount))?;
            let metadata = MetadataAccount::safe_deserialize(&metadata_data)
                .map_err(|_| Error::from(ErrorCode::InvalidCollectionMetadataAccount))?;
            let tlv_collection_details = read_collection_details_from_tlv(&metadata_data);
            let is_sized_collection =
                metadata.collection_details.is_some() || tlv_collection_details.is_some();
            drop(metadata_data);

            if is_sized_collection {
                VerifySizedCollectionItemCpi::new(
                    &metadata_program_info,
                    VerifySizedCollectionItemCpiAccounts {
                        metadata: &metadata_info,
                        collection_authority: &auth_info,
                        payer: &payer_info,
                        collection_mint: &collection_mint_info,
                        collection: &collection_metadata_account,
                        collection_master_edition_account: &collection_master_edition_account,
                        collection_authority_record: None,
                    },
                )
                .invoke_signed(auth_seeds)
                .map_err(anchor_lang::error::Error::from)?;
            } else {
                VerifyCollectionCpi::new(
                    &metadata_program_info,
                    VerifyCollectionCpiAccounts {
                        metadata: &metadata_info,
                        collection_authority: &auth_info,
                        payer: &payer_info,
                        collection_mint: &collection_mint_info,
                        collection: &collection_metadata_account,
                        collection_master_edition_account: &collection_master_edition_account,
                        collection_authority_record: None,
                    },
                )
                .invoke_signed(auth_seeds)
                .map_err(anchor_lang::error::Error::from)?;
            }
        }

        {
            let mut data = manifest_info.try_borrow_mut_data()?;
            let (_, rest) = data.split_at_mut(8);
            let manifest = from_bytes_mut::<ObjectManifest>(
                &mut rest[..core::mem::size_of::<ObjectManifest>()],
            );
            manifest.set_minted(true);
        }

        emit!(ObjectMinted {
            config: config_key,
            manifest: manifest_key,
            mint: mint_key,
            recipient: ctx.accounts.base.recipient.key(),
            object_id,
        });

        Ok(())
    }

    pub fn update_object_manifest(
        ctx: Context<UpdateObjectManifest>,
        manifest_hash: [u8; 32],
        metadata_uri: String,
        is_active: bool,
    ) -> Result<()> {
        require!(metadata_uri.len() <= MAX_URI_LENGTH, ErrorCode::UriTooLong);
        require!(
            metadata_uri.len() <= METADATA_MAX_URI_LENGTH,
            ErrorCode::UriTooLong
        );
        require_keys_eq!(
            ctx.accounts.owner_token_account.owner,
            ctx.accounts.owner.key(),
            ErrorCode::InvalidOwnerTokenAccount
        );
        require_keys_eq!(
            ctx.accounts.owner_token_account.mint,
            ctx.accounts.object_mint.key(),
            ErrorCode::MintMismatch
        );
        require!(
            ctx.accounts.owner_token_account.amount > 0,
            ErrorCode::OwnerDoesNotHoldObjectNft
        );

        require_keys_eq!(
            ctx.accounts.metadata_program.key(),
            mpl_program_id(),
            ErrorCode::InvalidTokenMetadataProgram
        );
        require_keys_eq!(
            ctx.accounts.rent.key(),
            sysvar::rent::id(),
            ErrorCode::InvalidRentSysvar
        );
        if let Some(ref instructions_sysvar) = ctx.accounts.instructions {
            require_keys_eq!(
                instructions_sysvar.key(),
                sysvar::instructions::id(),
                ErrorCode::InvalidInstructionsSysvar
            );
        }

        let manifest_info = ctx.accounts.object_manifest.to_account_info();
        let mut manifest = ctx.accounts.object_manifest.load_mut()?;

        require!(manifest.initialized(), ErrorCode::ManifestNotInitialized);
        require_keys_eq!(
            manifest.config,
            ctx.accounts.config.key(),
            ErrorCode::InvalidConfig
        );

        let (expected_manifest_key, expected_manifest_bump) = Pubkey::find_program_address(
            &[
                MANIFEST_SEED,
                ctx.accounts.config.key().as_ref(),
                &manifest.object_id.to_le_bytes(),
            ],
            ctx.program_id,
        );
        require_keys_eq!(
            manifest_info.key(),
            expected_manifest_key,
            ErrorCode::InvalidConfig
        );
        require!(
            manifest.bump == expected_manifest_bump,
            ErrorCode::InvalidConfig
        );
        require_keys_eq!(
            manifest.mint,
            ctx.accounts.object_mint.key(),
            ErrorCode::MintMismatch
        );

        let mint_key = ctx.accounts.object_mint.key();
        let mpl_mint_key = to_solana_pubkey(&mint_key);
        let (expected_metadata_mpl, _) = MetadataAccount::find_pda(&mpl_mint_key);
        let expected_metadata = from_solana_pubkey(&expected_metadata_mpl);
        require_keys_eq!(
            ctx.accounts.object_metadata.key(),
            expected_metadata,
            ErrorCode::InvalidMetadataAccount
        );

        manifest.manifest_hash = manifest_hash;
        manifest.set_metadata_uri(&metadata_uri);
        manifest.set_is_active(is_active);

        let config_key = manifest.config;
        let config_account_key = ctx.accounts.config.key();
        let manifest_mint = manifest.mint;
        let object_id = manifest.object_id;
        let manifest_pubkey = manifest_info.key();

        drop(manifest);

        let metadata_info = ctx.accounts.object_metadata.to_account_info();
        let metadata_account = {
            let metadata_data = metadata_info
                .try_borrow_data()
                .map_err(|_| Error::from(ErrorCode::InvalidMetadataAccount))?;
            let metadata = MetadataAccount::safe_deserialize(&metadata_data)
                .map_err(|_| Error::from(ErrorCode::InvalidMetadataAccount))?;
            drop(metadata_data);
            metadata
        };

        let mut data = DataV2 {
            name: metadata_account.name.clone(),
            symbol: metadata_account.symbol.clone(),
            uri: metadata_account.uri.clone(),
            seller_fee_basis_points: metadata_account.seller_fee_basis_points,
            creators: metadata_account.creators.clone(),
            collection: metadata_account.collection.clone(),
            uses: metadata_account.uses.clone(),
        };
        data.uri = metadata_uri.clone();

        let metadata_program_info = ctx.accounts.metadata_program.to_account_info();
        let auth_info = ctx.accounts.auth.to_account_info();
        let auth_seeds: &[&[u8]] = &[AUTH_SEED, config_account_key.as_ref(), &[ctx.accounts.auth.bump]];

        UpdateMetadataAccountV2Cpi::new(
            &metadata_program_info,
            UpdateMetadataAccountV2CpiAccounts {
                metadata: &metadata_info,
                update_authority: &auth_info,
            },
            UpdateMetadataAccountV2InstructionArgs {
                data: Some(data),
                new_update_authority: None,
                primary_sale_happened: None,
                is_mutable: None,
            },
        )
        .invoke_signed(&[auth_seeds])
        .map_err(anchor_lang::error::Error::from)?;

        emit!(ManifestUpdated {
            config: config_key,
            manifest: manifest_pubkey,
            mint: manifest_mint,
            object_id,
            is_active,
        });

        Ok(())
    }

    /// Creates a new configuration PDA under `new_namespace` using the state
    /// from `old_config`.
    ///
    /// This instruction allows the authority to migrate to a fresh namespace
    /// (for example, to rotate the config PDA) without requiring a program
    /// upgrade. After migration, callers should reference the new config and
    /// auth accounts.
    pub fn migrate_config_namespace(
        ctx: Context<MigrateConfigNamespace>,
        new_namespace: Pubkey,
    ) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let old_config = &ctx.accounts.old_config;
        require_keys_eq!(old_config.authority, authority, ErrorCode::InvalidAuthority);

        let new_config = &mut ctx.accounts.new_config;
        new_config.authority = old_config.authority;
        new_config.config_bump = ctx.bumps.new_config;
        new_config.auth_bump = ctx.bumps.new_auth;
        new_config.object_count = old_config.object_count;
        new_config.namespace = new_namespace;
        new_config.paused = old_config.paused;

        let new_auth = &mut ctx.accounts.new_auth;
        new_auth.config = new_config.key();
        new_auth.bump = ctx.bumps.new_auth;

        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.paused = paused;

        emit!(PauseStatusUpdated {
            config: config.key(),
            paused,
        });

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatorInput {
    pub address: Pubkey,
    pub verified: bool,
    pub share: u8,
}

#[derive(Accounts)]
#[instruction(namespace: Pubkey)]
pub struct Initialize<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = Config::LEN,
        seeds = [CONFIG_SEED, namespace.as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = Auth::LEN,
        seeds = [AUTH_SEED, config.key().as_ref()],
        bump
    )]
    pub auth: Account<'info, Auth>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(object_id: u64)]
pub struct MintObjectNft<'info> {
    pub base: MintObjectNftBase<'info>,
    pub metadata: MintObjectNftMetadata<'info>,
}

#[derive(Accounts)]
#[instruction(object_id: u64)]
pub struct MintObjectNftBase<'info> {
    /// CHECK: The config account enforces this matches its stored authority.
    pub authority: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, config.namespace.as_ref()],
        bump = config.config_bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [AUTH_SEED, config.key().as_ref()],
        bump = config.auth_bump,
        has_one = config @ ErrorCode::InvalidConfig
    )]
    pub auth: Box<Account<'info, Auth>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Created and size-checked within the instruction.
    #[account(mut)]
    pub object_manifest: UncheckedAccount<'info>,
    /// CHECK: Created and initialized within the instruction.
    #[account(mut)]
    pub object_mint: UncheckedAccount<'info>,
    /// CHECK: Created and verified within the instruction.
    #[account(mut)]
    pub recipient_token_account: UncheckedAccount<'info>,
    /// CHECK: Recipient can be any account
    pub recipient: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Clone)]
/// Additional remaining accounts expected (in order):
/// 0. Collection metadata PDA (mut)
/// 1. Collection master edition PDA (mut)
/// 2. Rent sysvar account
/// 3. Instructions sysvar account (optional, unused for unsized collections)
pub struct MintObjectNftMetadata<'info> {
    #[account(mut)]
    /// CHECK: Created via Metaplex CPI
    pub metadata: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Created via Metaplex CPI
    pub master_edition: UncheckedAccount<'info>,
    /// CHECK: Verified against expected seeds
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK: Verified to match the Metaplex token metadata program id
    pub token_metadata_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RotateCollectionAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, config.namespace.as_ref()],
        bump = config.config_bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [AUTH_SEED, config.key().as_ref()],
        bump = config.auth_bump,
        has_one = config @ ErrorCode::InvalidConfig
    )]
    pub auth: Box<Account<'info, Auth>>,
    #[account(mut)]
    /// CHECK: Verified against derived PDA within the instruction
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK: Only used for PDA derivation
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK: Validated to match the Metaplex token metadata program id
    pub token_metadata_program: UncheckedAccount<'info>,
}

fn metadata_remaining_accounts<'info>(
    remaining_accounts: &'info [AccountInfo<'info>],
) -> Result<(
    AccountInfo<'info>,
    AccountInfo<'info>,
    AccountInfo<'info>,
    Option<AccountInfo<'info>>,
    &'info [AccountInfo<'info>],
)> {
    require!(
        remaining_accounts.len() >= 3,
        ErrorCode::MissingMintMetadataAccounts
    );

    let mut extra_index = 3;
    let instructions_sysvar_account = if let Some(account) = remaining_accounts.get(3) {
        if account.key() == sysvar::instructions::id() {
            extra_index = 4;
            Some(account.clone())
        } else {
            None
        }
    } else {
        None
    };

    let extra_accounts = if extra_index < remaining_accounts.len() {
        &remaining_accounts[extra_index..]
    } else {
        &[]
    };

    Ok((
        remaining_accounts[0].clone(),
        remaining_accounts[1].clone(),
        remaining_accounts[2].clone(),
        instructions_sysvar_account,
        extra_accounts,
    ))
}

fn ensure_object_manifest_account<'info>(
    manifest: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    program_id: &Pubkey,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(ObjectManifest::LEN);

    if manifest.data_len() == 0 {
        let create_ix = system_instruction::create_account(
            payer.key,
            manifest.key,
            required_lamports,
            ObjectManifest::LEN as u64,
            program_id,
        );
        invoke_signed(
            &create_ix,
            &[payer.clone(), manifest.clone(), system_program.clone()],
            &[signer_seeds],
        )?;
    } else {
        require!(
            *manifest.owner == *program_id,
            ErrorCode::InvalidManifestAccount
        );

        if manifest.lamports() < required_lamports {
            let additional = required_lamports.saturating_sub(manifest.lamports());
            **payer.try_borrow_mut_lamports()? -= additional;
            **manifest.try_borrow_mut_lamports()? += additional;
        }

        if manifest.data_len() < ObjectManifest::LEN {
            manifest.realloc(ObjectManifest::LEN, true)?;
        }
    }

    Ok(())
}

fn ensure_object_mint_account<'info>(
    mint: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    authority: &AccountInfo<'info>,
) -> Result<()> {
    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(Mint::LEN);

    if mint.data_len() == 0 {
        let create_ix = system_instruction::create_account(
            payer.key,
            mint.key,
            required_lamports,
            Mint::LEN as u64,
            &token::ID,
        );
        invoke_signed(
            &create_ix,
            &[payer.clone(), mint.clone(), system_program.clone()],
            &[signer_seeds],
        )?;

        token::initialize_mint2(
            CpiContext::new_with_signer(
                token_program.clone(),
                InitializeMint2 { mint: mint.clone() },
                &[signer_seeds],
            ),
            0,
            authority.key,
            Some(authority.key),
        )?;
    } else {
        require!(
            mint.owner == &token::ID,
            ErrorCode::InvalidObjectMintAccount
        );
    }

    if mint.lamports() < required_lamports {
        let additional = required_lamports.saturating_sub(mint.lamports());
        **payer.try_borrow_mut_lamports()? -= additional;
        **mint.try_borrow_mut_lamports()? += additional;
    }

    Ok(())
}

fn ensure_recipient_token_account<'info>(
    token_account: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
) -> Result<()> {
    if token_account.data_len() == 0 {
        let cpi_accounts = associated_token::Create {
            payer: payer.clone(),
            associated_token: token_account.clone(),
            authority: authority.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_program.clone(),
        };
        associated_token::create(CpiContext::new(
            associated_token_program.clone(),
            cpi_accounts,
        ))?;
    } else {
        require!(
            token_account.owner == &token::ID,
            ErrorCode::InvalidRecipientTokenAccount
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateObjectManifest<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, config.namespace.as_ref()],
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [AUTH_SEED, config.key().as_ref()],
        bump = config.auth_bump,
        has_one = config @ ErrorCode::InvalidConfig
    )]
    pub auth: Account<'info, Auth>,
    #[account(mut)]
    pub object_manifest: AccountLoader<'info, ObjectManifest>,
    pub object_mint: Account<'info, Mint>,
    pub owner_token_account: Account<'info, TokenAccount>,
    /// CHECK: Verified against the expected Metaplex metadata PDA
    #[account(mut)]
    pub object_metadata: UncheckedAccount<'info>,
    /// CHECK: Validated to match the Metaplex token metadata program id
    pub metadata_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: Optional sysvar, only used when present
    pub instructions: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, config.namespace.as_ref()],
        bump = config.config_bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, config.namespace.as_ref()],
        bump = config.config_bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(new_namespace: Pubkey)]
pub struct MigrateConfigNamespace<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, old_config.namespace.as_ref()],
        bump = old_config.config_bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub old_config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = Config::LEN,
        seeds = [CONFIG_SEED, new_namespace.as_ref()],
        bump
    )]
    pub new_config: Account<'info, Config>,
    #[account(
        seeds = [AUTH_SEED, old_config.key().as_ref()],
        bump = old_config.auth_bump,
        constraint = old_auth.config == old_config.key() @ ErrorCode::InvalidConfig
    )]
    pub old_auth: Account<'info, Auth>,
    #[account(
        init,
        payer = authority,
        space = Auth::LEN,
        seeds = [AUTH_SEED, new_config.key().as_ref()],
        bump
    )]
    pub new_auth: Account<'info, Auth>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub config_bump: u8,
    pub auth_bump: u8,
    pub object_count: u64,
    pub namespace: Pubkey,
    pub paused: bool,
}

impl Config {
    pub const LEN: usize = 8 + 32 + 1 + 1 + 8 + 32 + 1;
}

#[account]
pub struct Auth {
    pub config: Pubkey,
    pub bump: u8,
}

impl Auth {
    pub const LEN: usize = 8 + 32 + 1;
}

#[account(zero_copy)]
#[repr(C)]
pub struct ObjectManifest {
    pub config: Pubkey,
    pub object_id: u64,
    pub mint: Pubkey,
    pub bump: u8,
    pub mint_bump: u8,
    pub is_active: u8,
    pub minted: u8,
    pub initialized: u8,
    pub manifest_hash: [u8; 32],
    pub metadata_uri: [u8; MAX_URI_LENGTH],
    pub metadata_uri_padding: u8,
    pub metadata_uri_length: u16,
    pub creator: Pubkey,
}

impl ObjectManifest {
    pub const LEN: usize = 8 + core::mem::size_of::<ObjectManifest>() + MANIFEST_PADDING;

    pub fn metadata_uri_len(&self) -> usize {
        self.metadata_uri_length as usize
    }

    pub fn is_active(&self) -> bool {
        self.is_active != 0
    }

    pub fn set_is_active(&mut self, value: bool) {
        self.is_active = value.into();
    }

    pub fn minted(&self) -> bool {
        self.minted != 0
    }

    pub fn set_minted(&mut self, value: bool) {
        self.minted = value.into();
    }

    pub fn initialized(&self) -> bool {
        self.initialized != 0
    }

    pub fn set_initialized(&mut self, value: bool) {
        self.initialized = value.into();
    }

    pub fn metadata_uri_equals(&self, uri: &str) -> bool {
        self.metadata_uri_str() == uri
    }

    pub fn metadata_uri_string(&self) -> String {
        self.metadata_uri_str().to_string()
    }

    pub fn set_metadata_uri(&mut self, uri: &str) {
        let bytes = uri.as_bytes();
        let len = bytes.len();
        self.metadata_uri[..len].copy_from_slice(bytes);
        for byte in self.metadata_uri[len..].iter_mut() {
            *byte = 0;
        }
        self.metadata_uri_padding = 0;
        self.metadata_uri_length = len as u16;
    }

    fn metadata_uri_str(&self) -> &str {
        let len = self.metadata_uri_len();
        // Safety: the URI bytes are always written from a valid UTF-8 string via
        // `set_metadata_uri`.
        unsafe { core::str::from_utf8_unchecked(&self.metadata_uri[..len]) }
    }
}

#[event]
pub struct ObjectMinted {
    pub config: Pubkey,
    pub manifest: Pubkey,
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub object_id: u64,
}

#[event]
pub struct ManifestUpdated {
    pub config: Pubkey,
    pub manifest: Pubkey,
    pub mint: Pubkey,
    pub object_id: u64,
    pub is_active: bool,
}

#[event]
pub struct PauseStatusUpdated {
    pub config: Pubkey,
    pub paused: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The provided authority does not match the configuration authority.")]
    InvalidAuthority,
    #[msg("Manifest metadata URI exceeds the permitted length.")]
    UriTooLong,
    #[msg("The requested object is currently inactive.")]
    ObjectInactive,
    #[msg("The object manifest has not been initialized yet.")]
    ManifestNotInitialized,
    #[msg("The supplied object identifier does not match the stored manifest.")]
    ObjectIdMismatch,
    #[msg("The manifest is associated with a different configuration account.")]
    InvalidConfig,
    #[msg("The supplied manifest account does not match the expected address.")]
    InvalidManifestAccount,
    #[msg("The manifest account data is too small to store the object manifest.")]
    ManifestAccountTooSmall,
    #[msg("The supplied object mint account does not match the expected address.")]
    InvalidObjectMintAccount,
    #[msg("The mint provided does not match the stored mint for this object.")]
    MintMismatch,
    #[msg("The provided token account does not belong to the connected signer.")]
    InvalidOwnerTokenAccount,
    #[msg("The connected wallet must hold the object NFT to perform this action.")]
    OwnerDoesNotHoldObjectNft,
    #[msg("The supplied manifest metadata does not match the stored value.")]
    ManifestMismatch,
    #[msg("The recipient token account does not belong to the supplied recipient.")]
    RecipientMismatch,
    #[msg("The signer is not authorized to deploy the object registry.")]
    UnauthorizedDeployer,
    #[msg("Minting has been paused by the registry authority.")]
    MintingPaused,
    #[msg("Metadata name exceeds the allowed length.")]
    MetadataNameTooLong,
    #[msg("Metadata symbol exceeds the allowed length.")]
    MetadataSymbolTooLong,
    #[msg("Invalid metadata creator share distribution.")]
    InvalidCreatorShareDistribution,
    #[msg("Too many metadata creators supplied.")]
    TooManyCreators,
    #[msg("Seller fee basis points exceed the permitted maximum.")]
    InvalidSellerFeeBasisPoints,
    #[msg("The provided token metadata program is invalid.")]
    InvalidTokenMetadataProgram,
    #[msg("Insufficient remaining accounts supplied for metadata validation.")]
    MissingMintMetadataAccounts,
    #[msg("The provided rent sysvar account is invalid.")]
    InvalidRentSysvar,
    #[msg("Metadata account does not match the expected address.")]
    InvalidMetadataAccount,
    #[msg("Master edition account does not match the expected address.")]
    InvalidMasterEditionAccount,
    #[msg("Collection metadata account does not match the expected address.")]
    InvalidCollectionMetadataAccount,
    #[msg("Collection master edition account does not match the expected address.")]
    InvalidCollectionMasterEditionAccount,
    #[msg("The provided instructions sysvar account is invalid.")]
    InvalidInstructionsSysvar,
    #[msg("Metadata creators must include the recorded object creator.")]
    MissingManifestCreator,
    #[msg("The supplied recipient token account does not match the expected address.")]
    InvalidRecipientTokenAccount,
    #[msg("All verified metadata creators must sign the transaction.")]
    CreatorMustSign,
}

fn is_allowed_deployer(authority: &Pubkey) -> bool {
    ALLOWED_DEPLOYERS.iter().any(|allowed| allowed == authority)
}
