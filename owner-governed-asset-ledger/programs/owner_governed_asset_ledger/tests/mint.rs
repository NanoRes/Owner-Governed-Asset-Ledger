use anchor_lang::solana_program::{entrypoint::ProgramResult, sysvar};
use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use borsh::BorshSerialize;
use mpl_token_metadata::{
    accounts::{MasterEdition as MetadataMasterEdition, Metadata as MetadataAccount},
    instructions::{SetCollectionSize, SetCollectionSizeInstructionArgs},
    types::{CollectionDetails, Key, SetCollectionSizeArgs},
};
use owner_governed_asset_ledger::{self, CreatorInput, ErrorCode, ObjectManifest};
use serial_test::serial;
use solana_program_test::{processor, BanksClientError, ProgramTest};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction, InstructionError},
    program_pack::Pack,
    rent::Rent,
    signer::keypair::Keypair,
    signer::Signer,
    system_program,
    transaction::{Transaction, TransactionError},
};
use spl_associated_token_account::ID as ASSOCIATED_TOKEN_ID;
use spl_token::ID as TOKEN_ID;
use std::mem;

use spl_discriminator::ArrayDiscriminator;

fn process_instruction_adapter<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    data: &'d [u8],
) -> ProgramResult {
    // Anchor's generated entrypoint requires a homogeneous lifetime across the
    // account slice and each `AccountInfo`. The adapter safely coerces the
    // slice reference to satisfy that requirement for the duration of the
    // invocation.
    let accounts: &'c [AccountInfo<'c>] = unsafe { std::mem::transmute(accounts) };
    owner_governed_asset_ledger::entry(program_id, accounts, data)
}

const CONFIG_SEED: &[u8] = b"config";
const AUTH_SEED: &[u8] = b"auth";
const MANIFEST_SEED: &[u8] = b"object_manifest";
const MINT_SEED: &[u8] = b"object_mint";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VerifyKind {
    Sized,
    Unsized,
}

struct CreatorContext {
    payer: Pubkey,
    collection_metadata: Pubkey,
}

struct MintInvocationConfig {
    creators: Vec<CreatorInput>,
    extra_remaining_accounts: Vec<AccountMeta>,
}

impl MintInvocationConfig {
    fn new(creators: Vec<CreatorInput>) -> Self {
        Self {
            creators,
            extra_remaining_accounts: Vec::new(),
        }
    }
}

struct PrebakedCollectionMetadata {
    data: Vec<u8>,
    mint: Pubkey,
}

fn append_collection_details_tlv(buffer: &mut Vec<u8>, details: &CollectionDetails) {
    let mut value = Vec::new();
    details.serialize(&mut value).unwrap();
    let discriminator = ArrayDiscriminator::new_with_hash_input("collection_details");
    buffer.extend_from_slice(discriminator.as_ref());
    buffer.extend_from_slice(&(value.len() as u32).to_le_bytes());
    buffer.extend_from_slice(&value);
}

fn prebaked_collection_metadata_with_truncated_options(size: u64) -> PrebakedCollectionMetadata {
    let collection_mint = Pubkey::new_unique();
    let metadata_state = MetadataAccount {
        key: Key::MetadataV1,
        update_authority: Pubkey::new_unique(),
        mint: collection_mint,
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
    metadata_state.serialize(&mut data).unwrap();

    let programmable_marker = data.pop().expect("programmable config option");
    assert_eq!(programmable_marker, 0);
    let collection_marker = data.pop().expect("collection details option");
    assert_eq!(collection_marker, 0);

    append_collection_details_tlv(&mut data, &CollectionDetails::V1 { size });

    PrebakedCollectionMetadata {
        data,
        mint: collection_mint,
    }
}

mod metadata_mock {
    use super::{
        append_collection_details_tlv, AccountInfo, CollectionDetails, MetadataAccount,
        ProgramResult, Pubkey, SetCollectionSizeArgs, SetCollectionSizeInstructionArgs, VerifyKind,
        TOKEN_ID,
    };
    use anchor_lang::solana_program::{
        account_info::next_account_info, program_error::ProgramError,
    };
    use borsh::{BorshDeserialize, BorshSerialize};
    use once_cell::sync::Lazy;
    use std::sync::Mutex;

    static VERIFY_CALLS: Lazy<Mutex<Vec<VerifyKind>>> = Lazy::new(|| Mutex::new(Vec::new()));

    pub fn reset() {
        VERIFY_CALLS.lock().unwrap().clear();
    }

    pub fn verify_calls() -> Vec<VerifyKind> {
        VERIFY_CALLS.lock().unwrap().clone()
    }

    pub fn process_instruction(
        _program_id: &Pubkey,
        _accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        match instruction_data.first().copied() {
            Some(30) => {
                VERIFY_CALLS.lock().unwrap().push(VerifyKind::Sized);
                Ok(())
            }
            Some(18) => {
                VERIFY_CALLS.lock().unwrap().push(VerifyKind::Unsized);
                Ok(())
            }
            Some(34) => process_set_collection_size(_program_id, _accounts, instruction_data),
            _ => Ok(()),
        }
    }

    fn process_set_collection_size(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        let mut args_data = &instruction_data[1..];
        let args = SetCollectionSizeInstructionArgs::deserialize(&mut args_data)
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        let account_info_iter = &mut accounts.iter();
        let metadata_info = next_account_info(account_info_iter)?;
        let collection_authority_info = next_account_info(account_info_iter)?;
        let collection_mint_info = next_account_info(account_info_iter)?;

        if metadata_info.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        if *collection_mint_info.owner != TOKEN_ID {
            return Err(ProgramError::IncorrectProgramId);
        }

        if !collection_authority_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let metadata_data = metadata_info.try_borrow_data()?;
        let mut metadata = MetadataAccount::deserialize(&mut &metadata_data[..])
            .map_err(|_| ProgramError::InvalidAccountData)?;
        drop(metadata_data);

        if metadata.update_authority != *collection_authority_info.key {
            return Err(ProgramError::InvalidAccountData);
        }

        if metadata.collection_details.is_some() {
            return Err(ProgramError::InvalidAccountData);
        }

        let mut serialized = Vec::new();
        metadata.collection_details = None;
        metadata
            .serialize(&mut serialized)
            .map_err(|_| ProgramError::AccountDataTooSmall)?;

        append_collection_details_tlv(
            &mut serialized,
            &CollectionDetails::V1 {
                size: match args.set_collection_size_args {
                    SetCollectionSizeArgs { size } => size,
                },
            },
        );

        let mut metadata_data = metadata_info.try_borrow_mut_data()?;
        if serialized.len() > metadata_data.len() {
            return Err(ProgramError::AccountDataTooSmall);
        }
        metadata_data[..serialized.len()].copy_from_slice(&serialized);
        metadata_data[serialized.len()..].fill(0);

        Ok(())
    }
}

mod metadata_program_stub {
    use super::*;
    use anchor_lang::solana_program::{
        account_info::next_account_info, program_error::ProgramError,
    };
    use borsh::BorshDeserialize;
    use mpl_token_metadata::instructions::SetCollectionSizeInstructionArgs;
    use mpl_token_metadata::types::SetCollectionSizeArgs;

    pub fn process_instruction(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        if instruction_data.first().copied() != Some(34) {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut args_data = &instruction_data[1..];
        let args = SetCollectionSizeInstructionArgs::deserialize(&mut args_data)
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        set_collection_size(program_id, accounts, args.set_collection_size_args)
    }

    fn set_collection_size(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        args: SetCollectionSizeArgs,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let metadata_info = next_account_info(account_info_iter)?;
        let collection_authority_info = next_account_info(account_info_iter)?;
        let collection_mint_info = next_account_info(account_info_iter)?;

        if metadata_info.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        if *collection_mint_info.owner != TOKEN_ID {
            return Err(ProgramError::IncorrectProgramId);
        }

        if !collection_authority_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let metadata_data = metadata_info.try_borrow_data()?;
        let mut metadata = MetadataAccount::deserialize(&mut &metadata_data[..])
            .map_err(|_| ProgramError::InvalidAccountData)?;
        drop(metadata_data);

        if metadata.update_authority != *collection_authority_info.key {
            return Err(ProgramError::InvalidAccountData);
        }

        if metadata.collection_details.is_some() {
            return Err(ProgramError::InvalidAccountData);
        }

        let mut serialized = Vec::new();
        metadata.collection_details = None;
        metadata
            .serialize(&mut serialized)
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
        append_collection_details_tlv(&mut serialized, &CollectionDetails::V1 { size: args.size });

        let mut metadata_data = metadata_info.try_borrow_mut_data()?;
        if serialized.len() > metadata_data.len() {
            return Err(ProgramError::AccountDataTooSmall);
        }
        metadata_data[..serialized.len()].copy_from_slice(&serialized);
        metadata_data[serialized.len()..].fill(0);

        Ok(())
    }
}

#[tokio::test(flavor = "current_thread")]
#[serial]
async fn mint_succeeds_for_sized_collection() {
    let collection_details = Some(CollectionDetails::V1 { size: 1 });
    let verify_calls = execute_mint(collection_details, None).await;

    assert_eq!(verify_calls, vec![VerifyKind::Sized]);
}

#[tokio::test(flavor = "current_thread")]
#[serial]
async fn mint_succeeds_for_tlv_sized_collection() {
    let tlv_details = Some(CollectionDetails::V1 { size: 1 });
    let verify_calls = execute_mint(None, tlv_details).await;

    assert_eq!(verify_calls, vec![VerifyKind::Sized]);
}

#[tokio::test(flavor = "current_thread")]
#[serial]
async fn mint_succeeds_for_truncated_tlv_sized_collection() {
    let metadata = prebaked_collection_metadata_with_truncated_options(1);
    let verify_calls = execute_mint_with_metadata_override(metadata, |context| {
        MintInvocationConfig::new(vec![CreatorInput {
            address: context.payer,
            verified: true,
            share: 100,
        }])
    })
    .await
    .unwrap();

    assert_eq!(verify_calls, vec![VerifyKind::Sized]);
}

#[tokio::test(flavor = "current_thread")]
#[serial]
async fn mint_succeeds_for_unsized_collection() {
    let verify_calls = execute_mint(None, None).await;

    assert_eq!(verify_calls, vec![VerifyKind::Unsized]);
}

#[tokio::test(flavor = "current_thread")]
#[serial]
async fn mint_uses_verify_sized_after_real_set_collection_size() {
    let metadata = create_collection_metadata_with_cpi_size(1).await;
    let verify_calls = execute_mint_with_metadata_override(metadata, |context| {
        MintInvocationConfig::new(vec![CreatorInput {
            address: context.payer,
            verified: true,
            share: 100,
        }])
    })
    .await
    .unwrap();

    assert_eq!(verify_calls, vec![VerifyKind::Sized]);
}

async fn execute_mint(
    collection_details: Option<CollectionDetails>,
    tlv_collection_details: Option<CollectionDetails>,
) -> Vec<VerifyKind> {
    execute_mint_with_creators_internal(
        collection_details,
        tlv_collection_details,
        None,
        |context| {
            MintInvocationConfig::new(vec![CreatorInput {
                address: context.payer,
                verified: true,
                share: 100,
            }])
        },
    )
    .await
    .unwrap()
}

async fn execute_mint_with_creators<F>(
    collection_details: Option<CollectionDetails>,
    tlv_collection_details: Option<CollectionDetails>,
    build_creators: F,
) -> std::result::Result<Vec<VerifyKind>, BanksClientError>
where
    F: FnOnce(CreatorContext) -> MintInvocationConfig,
{
    execute_mint_with_creators_internal(
        collection_details,
        tlv_collection_details,
        None,
        build_creators,
    )
    .await
}

async fn execute_mint_with_metadata_override<F>(
    metadata_override: PrebakedCollectionMetadata,
    build_creators: F,
) -> std::result::Result<Vec<VerifyKind>, BanksClientError>
where
    F: FnOnce(CreatorContext) -> MintInvocationConfig,
{
    execute_mint_with_creators_internal(None, None, Some(metadata_override), build_creators).await
}

async fn execute_mint_with_creators_internal<F>(
    collection_details: Option<CollectionDetails>,
    tlv_collection_details: Option<CollectionDetails>,
    metadata_override: Option<PrebakedCollectionMetadata>,
    build_creators: F,
) -> std::result::Result<Vec<VerifyKind>, BanksClientError>
where
    F: FnOnce(CreatorContext) -> MintInvocationConfig,
{
    metadata_mock::reset();

    let mut program_test = ProgramTest::new(
        "owner-governed-asset-ledger",
        owner_governed_asset_ledger::id(),
        processor!(process_instruction_adapter),
    );
    program_test.add_program(
        "spl_token",
        TOKEN_ID,
        processor!(spl_token::processor::Processor::process),
    );
    program_test.add_program(
        "spl_associated_token_account",
        ASSOCIATED_TOKEN_ID,
        processor!(spl_associated_token_account::processor::process_instruction),
    );
    program_test.add_program(
        "mpl_token_metadata",
        mpl_token_metadata::ID,
        processor!(metadata_mock::process_instruction),
    );

    let rent = Rent::default();
    let collection_authority = Keypair::new();
    let (collection_mint, mut metadata_data) = if let Some(prebaked) = metadata_override {
        (prebaked.mint, prebaked.data)
    } else {
        let collection_mint = Pubkey::new_unique();
        let metadata_state = MetadataAccount {
            key: Key::MetadataV1,
            update_authority: collection_authority.pubkey(),
            mint: collection_mint,
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
            collection_details: collection_details.clone(),
            programmable_config: None,
        };
        let mut data = Vec::new();
        metadata_state.serialize(&mut data).unwrap();
        if tlv_collection_details.is_some() {
            data.extend_from_slice(&vec![0u8; 64]);
        }
        (collection_mint, data)
    };
    let (collection_metadata_pda, _) = MetadataAccount::find_pda(&collection_mint);
    let (collection_master_edition_pda, _) = MetadataMasterEdition::find_pda(&collection_mint);
    let collection_metadata_account = Account {
        lamports: rent.minimum_balance(metadata_data.len()),
        data: metadata_data,
        owner: mpl_token_metadata::ID,
        executable: false,
        rent_epoch: 0,
    };
    program_test.add_account(collection_metadata_pda, collection_metadata_account);

    let collection_mint_account = Account {
        lamports: rent.minimum_balance(spl_token::state::Mint::LEN),
        data: vec![0; spl_token::state::Mint::LEN],
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    };
    program_test.add_account(collection_mint, collection_mint_account);

    let master_edition_account = Account {
        lamports: rent.minimum_balance(0),
        data: Vec::new(),
        owner: mpl_token_metadata::ID,
        executable: false,
        rent_epoch: 0,
    };
    program_test.add_account(collection_master_edition_pda, master_edition_account);

    let instructions_account = Account::new(1, 0, &sysvar::instructions::ID);
    program_test.add_account(sysvar::instructions::id(), instructions_account);

    program_test.add_account(
        collection_authority.pubkey(),
        Account::new(1_000_000_000, 0, &system_program::ID),
    );

    let (mut banks_client, payer, _recent_blockhash) = program_test.start().await;

    if let Some(CollectionDetails::V1 { size }) = tlv_collection_details {
        let instruction = SetCollectionSize {
            collection_metadata: collection_metadata_pda,
            collection_authority: collection_authority.pubkey(),
            collection_mint,
            collection_authority_record: None,
        }
        .instruction(SetCollectionSizeInstructionArgs {
            set_collection_size_args: SetCollectionSizeArgs { size },
        });

        let latest_blockhash = banks_client.get_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&payer.pubkey()),
            &[&payer, &collection_authority],
            latest_blockhash,
        );
        banks_client.process_transaction(tx).await.unwrap();

        let metadata_account = banks_client
            .get_account(collection_metadata_pda)
            .await
            .unwrap()
            .unwrap();
    }

    let namespace = Pubkey::new_unique();
    let (config_pda, _) = Pubkey::find_program_address(
        &[CONFIG_SEED, namespace.as_ref()],
        &owner_governed_asset_ledger::id(),
    );
    let (auth_pda, _) = Pubkey::find_program_address(
        &[AUTH_SEED, config_pda.as_ref()],
        &owner_governed_asset_ledger::id(),
    );

    let initialize_accounts = owner_governed_asset_ledger::accounts::Initialize {
        authority: payer.pubkey(),
        payer: payer.pubkey(),
        config: config_pda,
        auth: auth_pda,
        system_program: system_program::ID,
    };
    let initialize_ix = Instruction {
        program_id: owner_governed_asset_ledger::id(),
        accounts: initialize_accounts.to_account_metas(None),
        data: owner_governed_asset_ledger::instruction::Initialize { namespace }.data(),
    };
    let latest_blockhash = banks_client.get_latest_blockhash().await.unwrap();
    let mut initialize_tx = Transaction::new_with_payer(&[initialize_ix], Some(&payer.pubkey()));
    initialize_tx.sign(&[&payer], latest_blockhash);
    banks_client
        .process_transaction(initialize_tx)
        .await
        .unwrap();

    let object_id = 1u64;
    let (manifest_pda, _) = Pubkey::find_program_address(
        &[MANIFEST_SEED, config_pda.as_ref(), &object_id.to_le_bytes()],
        &owner_governed_asset_ledger::id(),
    );
    let (object_mint_pda, _) = Pubkey::find_program_address(
        &[MINT_SEED, manifest_pda.as_ref()],
        &owner_governed_asset_ledger::id(),
    );
    let (metadata_pda, _) = MetadataAccount::find_pda(&object_mint_pda);
    let (master_edition_pda, _) = MetadataMasterEdition::find_pda(&object_mint_pda);
    let recipient = payer.pubkey();
    let recipient_token_account = get_associated_token_address(&recipient, &object_mint_pda);

    let mint_accounts = owner_governed_asset_ledger::accounts::MintObjectNft {
        base: owner_governed_asset_ledger::accounts::MintObjectNftBase {
            authority: payer.pubkey(),
            config: config_pda,
            auth: auth_pda,
            payer: payer.pubkey(),
            object_manifest: manifest_pda,
            object_mint: object_mint_pda,
            recipient_token_account,
            recipient,
            token_program: TOKEN_ID,
            associated_token_program: ASSOCIATED_TOKEN_ID,
            system_program: system_program::ID,
        },
        metadata: owner_governed_asset_ledger::accounts::MintObjectNftMetadata {
            metadata: metadata_pda,
            master_edition: master_edition_pda,
            collection_mint,
            token_metadata_program: mpl_token_metadata::ID,
        },
    };
    let invocation_config = build_creators(CreatorContext {
        payer: payer.pubkey(),
        collection_metadata: collection_metadata_pda,
    });
    let creators = invocation_config.creators;

    let mut mint_ix = Instruction {
        program_id: owner_governed_asset_ledger::id(),
        accounts: mint_accounts.to_account_metas(None),
        data: owner_governed_asset_ledger::instruction::MintObjectNft {
            object_id,
            manifest_uri: "https://example.com/manifest.json".into(),
            manifest_hash: [7u8; 32],
            metadata_name: "Token Toss UGC Level".into(),
            metadata_symbol: "TT".into(),
            seller_fee_basis_points: 0,
            creators,
        }
        .data(),
    };
    mint_ix.accounts.extend_from_slice(&[
        AccountMeta::new(collection_metadata_pda, false),
        AccountMeta::new(collection_master_edition_pda, false),
        AccountMeta::new_readonly(sysvar::rent::id(), false),
        AccountMeta::new_readonly(sysvar::instructions::id(), false),
    ]);
    mint_ix
        .accounts
        .extend(invocation_config.extra_remaining_accounts);

    let latest_blockhash = banks_client.get_latest_blockhash().await.unwrap();
    let mut mint_tx = Transaction::new_with_payer(&[mint_ix], Some(&payer.pubkey()));
    mint_tx.sign(&[&payer], latest_blockhash);
    banks_client.process_transaction(mint_tx).await?;

    let manifest_account = banks_client
        .get_account(manifest_pda)
        .await?
        .expect("manifest account");
    let manifest_slice = &manifest_account.data[8..8 + mem::size_of::<ObjectManifest>()];
    let manifest = bytemuck::from_bytes::<ObjectManifest>(manifest_slice);
    assert!(manifest.minted());

    Ok(metadata_mock::verify_calls())
}

async fn create_collection_metadata_with_cpi_size(size: u64) -> PrebakedCollectionMetadata {
    let mut program_test = ProgramTest::new(
        "mpl_token_metadata",
        mpl_token_metadata::ID,
        processor!(metadata_program_stub::process_instruction),
    );

    let rent = Rent::default();
    let collection_mint = Pubkey::new_unique();
    let collection_authority = Keypair::new();
    let (collection_metadata_pda, _) = MetadataAccount::find_pda(&collection_mint);

    let metadata_state = MetadataAccount {
        key: Key::MetadataV1,
        update_authority: collection_authority.pubkey(),
        mint: collection_mint,
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

    let mut metadata_data = Vec::new();
    metadata_state.serialize(&mut metadata_data).unwrap();
    metadata_data.extend_from_slice(&vec![0u8; 64]);
    program_test.add_account(
        collection_metadata_pda,
        Account {
            lamports: rent.minimum_balance(metadata_data.len()),
            data: metadata_data,
            owner: mpl_token_metadata::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    program_test.add_account(collection_mint, Account::new(1, 0, &spl_token::ID));
    program_test.add_account(
        collection_authority.pubkey(),
        Account::new(1_000_000_000, 0, &system_program::ID),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    let instruction = mpl_token_metadata::instructions::SetCollectionSize {
        collection_metadata: collection_metadata_pda,
        collection_authority: collection_authority.pubkey(),
        collection_mint,
        collection_authority_record: None,
    }
    .instruction(
        mpl_token_metadata::instructions::SetCollectionSizeInstructionArgs {
            set_collection_size_args: mpl_token_metadata::types::SetCollectionSizeArgs { size },
        },
    );

    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&payer.pubkey()),
        &[&payer, &collection_authority],
        recent_blockhash,
    );
    banks_client.process_transaction(tx).await.unwrap();

    let metadata_account = banks_client
        .get_account(collection_metadata_pda)
        .await
        .unwrap()
        .unwrap();

    PrebakedCollectionMetadata {
        data: metadata_account.data,
        mint: collection_mint,
    }
}

#[tokio::test(flavor = "current_thread")]
#[serial]
async fn mint_fails_when_verified_creator_missing_signature() {
    let result = execute_mint_with_creators(None, None, |context| {
        MintInvocationConfig::new(vec![
            CreatorInput {
                address: context.payer,
                verified: true,
                share: 80,
            },
            CreatorInput {
                address: context.collection_metadata,
                verified: true,
                share: 20,
            },
        ])
    })
    .await;

    let err = result.expect_err("missing signature should fail");
    match err {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            0,
            InstructionError::Custom(code),
        )) => {
            let expected: u32 = ErrorCode::CreatorMustSign.into();
            assert_eq!(code, expected);
        }
        other => panic!("unexpected error: {:?}", other),
    }
}

#[tokio::test(flavor = "current_thread")]
#[serial]
async fn mint_fails_without_authority_signature() {
    metadata_mock::reset();

    let mut program_test = ProgramTest::new(
        "owner-governed-asset-ledger",
        owner_governed_asset_ledger::id(),
        processor!(process_instruction_adapter),
    );
    program_test.add_program(
        "spl_token",
        TOKEN_ID,
        processor!(spl_token::processor::Processor::process),
    );
    program_test.add_program(
        "spl_associated_token_account",
        ASSOCIATED_TOKEN_ID,
        processor!(spl_associated_token_account::processor::process_instruction),
    );
    program_test.add_program(
        "mpl_token_metadata",
        mpl_token_metadata::ID,
        processor!(metadata_mock::process_instruction),
    );

    let rent = Rent::default();
    let collection_authority = Keypair::new();
    let collection_mint = Pubkey::new_unique();
    let metadata_state = MetadataAccount {
        key: Key::MetadataV1,
        update_authority: collection_authority.pubkey(),
        mint: collection_mint,
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

    let mut metadata_data = Vec::new();
    metadata_state.serialize(&mut metadata_data).unwrap();

    let (collection_metadata_pda, _) = MetadataAccount::find_pda(&collection_mint);
    let (collection_master_edition_pda, _) = MetadataMasterEdition::find_pda(&collection_mint);

    program_test.add_account(
        collection_metadata_pda,
        Account {
            lamports: rent.minimum_balance(metadata_data.len()),
            data: metadata_data,
            owner: mpl_token_metadata::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    program_test.add_account(
        collection_mint,
        Account::new(
            rent.minimum_balance(spl_token::state::Mint::LEN),
            spl_token::state::Mint::LEN,
            &spl_token::ID,
        ),
    );

    program_test.add_account(
        collection_master_edition_pda,
        Account::new(rent.minimum_balance(0), 0, &mpl_token_metadata::ID),
    );

    program_test.add_account(
        collection_authority.pubkey(),
        Account::new(1_000_000_000, 0, &system_program::ID),
    );

    let instructions_account = Account::new(1, 0, &sysvar::instructions::ID);
    program_test.add_account(sysvar::instructions::id(), instructions_account);

    let new_authority = Keypair::new();
    program_test.add_account(
        new_authority.pubkey(),
        Account::new(1_000_000_000, 0, &system_program::ID),
    );

    let (mut banks_client, payer, _recent_blockhash) = program_test.start().await;

    let namespace = Pubkey::new_unique();
    let (config_pda, _) = Pubkey::find_program_address(
        &[CONFIG_SEED, namespace.as_ref()],
        &owner_governed_asset_ledger::id(),
    );
    let (auth_pda, _) = Pubkey::find_program_address(
        &[AUTH_SEED, config_pda.as_ref()],
        &owner_governed_asset_ledger::id(),
    );

    let initialize_accounts = owner_governed_asset_ledger::accounts::Initialize {
        authority: payer.pubkey(),
        payer: payer.pubkey(),
        config: config_pda,
        auth: auth_pda,
        system_program: system_program::ID,
    };
    let initialize_ix = Instruction {
        program_id: owner_governed_asset_ledger::id(),
        accounts: initialize_accounts.to_account_metas(None),
        data: owner_governed_asset_ledger::instruction::Initialize { namespace }.data(),
    };
    let latest_blockhash = banks_client.get_latest_blockhash().await.unwrap();
    let mut initialize_tx = Transaction::new_with_payer(&[initialize_ix], Some(&payer.pubkey()));
    initialize_tx.sign(&[&payer], latest_blockhash);
    banks_client
        .process_transaction(initialize_tx)
        .await
        .unwrap();

    let set_authority_ix = Instruction {
        program_id: owner_governed_asset_ledger::id(),
        accounts: owner_governed_asset_ledger::accounts::SetAuthority {
            authority: payer.pubkey(),
            config: config_pda,
        }
        .to_account_metas(None),
        data: owner_governed_asset_ledger::instruction::SetAuthority {
            new_authority: new_authority.pubkey(),
        }
        .data(),
    };
    let latest_blockhash = banks_client.get_latest_blockhash().await.unwrap();
    let mut set_authority_tx =
        Transaction::new_with_payer(&[set_authority_ix], Some(&payer.pubkey()));
    set_authority_tx.sign(&[&payer], latest_blockhash);
    banks_client
        .process_transaction(set_authority_tx)
        .await
        .unwrap();

    let object_id = 1u64;
    let (manifest_pda, _) = Pubkey::find_program_address(
        &[MANIFEST_SEED, config_pda.as_ref(), &object_id.to_le_bytes()],
        &owner_governed_asset_ledger::id(),
    );
    let (object_mint_pda, _) = Pubkey::find_program_address(
        &[MINT_SEED, manifest_pda.as_ref()],
        &owner_governed_asset_ledger::id(),
    );
    let (metadata_pda, _) = MetadataAccount::find_pda(&object_mint_pda);
    let (master_edition_pda, _) = MetadataMasterEdition::find_pda(&object_mint_pda);
    let recipient = payer.pubkey();
    let recipient_token_account = get_associated_token_address(&recipient, &object_mint_pda);

    let mint_accounts = owner_governed_asset_ledger::accounts::MintObjectNft {
        base: owner_governed_asset_ledger::accounts::MintObjectNftBase {
            authority: new_authority.pubkey(),
            config: config_pda,
            auth: auth_pda,
            payer: payer.pubkey(),
            object_manifest: manifest_pda,
            object_mint: object_mint_pda,
            recipient_token_account,
            recipient,
            token_program: TOKEN_ID,
            associated_token_program: ASSOCIATED_TOKEN_ID,
            system_program: system_program::ID,
        },
        metadata: owner_governed_asset_ledger::accounts::MintObjectNftMetadata {
            metadata: metadata_pda,
            master_edition: master_edition_pda,
            collection_mint,
            token_metadata_program: mpl_token_metadata::ID,
        },
    };

    let mut mint_ix = Instruction {
        program_id: owner_governed_asset_ledger::id(),
        accounts: mint_accounts.to_account_metas(None),
        data: owner_governed_asset_ledger::instruction::MintObjectNft {
            object_id,
            manifest_uri: "https://example.com/manifest.json".into(),
            manifest_hash: [7u8; 32],
            metadata_name: "Token Toss UGC Level".into(),
            metadata_symbol: "TT".into(),
            seller_fee_basis_points: 0,
            creators: vec![CreatorInput {
                address: payer.pubkey(),
                verified: true,
                share: 100,
            }],
        }
        .data(),
    };
    mint_ix.accounts.extend_from_slice(&[
        AccountMeta::new(collection_metadata_pda, false),
        AccountMeta::new(collection_master_edition_pda, false),
        AccountMeta::new_readonly(sysvar::rent::id(), false),
        AccountMeta::new_readonly(sysvar::instructions::id(), false),
    ]);

    if let Some(account_meta) = mint_ix
        .accounts
        .iter_mut()
        .find(|meta| meta.pubkey == new_authority.pubkey())
    {
        account_meta.is_signer = false;
    }

    let latest_blockhash = banks_client.get_latest_blockhash().await.unwrap();
    let mint_tx = Transaction::new_signed_with_payer(
        &[mint_ix],
        Some(&payer.pubkey()),
        &[&payer],
        latest_blockhash,
    );
    let err = banks_client
        .process_transaction(mint_tx)
        .await
        .expect_err("missing authority signature should fail");

    match err {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => {
            let expected: u32 = anchor_lang::error::ErrorCode::AccountNotSigner.into();
            assert_eq!(code, expected);
        }
        other => panic!("unexpected error: {:?}", other),
    }
}
