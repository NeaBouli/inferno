// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BuilderRegistry
 * @notice On-chain registry for verified IFR builders and integration partners.
 *         Registration and removal controlled exclusively by Governance (Timelock).
 *         Used by Telegram Bot for topic access control and by PartnerVault
 *         for creator reward eligibility.
 *
 * @dev Part of IFR Phase 3 — Builder Ecosystem.
 *      Integrates with: IFRLock (access), PartnerVault (rewards), Governance (control)
 */

import "@openzeppelin/contracts/access/Ownable.sol";

contract BuilderRegistry is Ownable {

    // ── Structs ──────────────────────────────────────

    struct BuilderInfo {
        string  name;           // Project/builder name
        string  url;            // Website or GitHub URL
        string  category;       // "creator" | "integration" | "tooling" | "dao"
        uint256 registeredAt;   // Block timestamp
        bool    active;         // Active status
    }

    // ── State ─────────────────────────────────────────

    mapping(address => BuilderInfo) public builders;
    mapping(address => bool) public isBuilder;
    address[] private _builderList;

    // ── Events ────────────────────────────────────────

    event BuilderRegistered(
        address indexed wallet,
        string name,
        string category,
        uint256 timestamp
    );

    event BuilderRemoved(
        address indexed wallet,
        uint256 timestamp
    );

    event BuilderUpdated(
        address indexed wallet,
        string name,
        string url,
        string category
    );

    // ── Errors ────────────────────────────────────────

    error AlreadyRegistered(address wallet);
    error NotRegistered(address wallet);
    error InvalidAddress();
    error EmptyName();
    error InvalidCategory();

    // ── Valid Categories ──────────────────────────────

    bytes32 private constant CAT_CREATOR     = keccak256("creator");
    bytes32 private constant CAT_INTEGRATION = keccak256("integration");
    bytes32 private constant CAT_TOOLING     = keccak256("tooling");
    bytes32 private constant CAT_DAO         = keccak256("dao");

    // ── Constructor ───────────────────────────────────

    constructor(address governance_) Ownable(governance_) {}

    // ── External Functions (onlyOwner = Governance) ──

    /**
     * @notice Register a new builder. Only callable by Governance (Timelock).
     * @param wallet  Builder wallet address
     * @param name    Project name (non-empty)
     * @param url     Website or GitHub URL
     * @param category "creator" | "integration" | "tooling" | "dao"
     */
    function registerBuilder(
        address wallet,
        string calldata name,
        string calldata url,
        string calldata category
    ) external onlyOwner {
        if (wallet == address(0))           revert InvalidAddress();
        if (isBuilder[wallet])              revert AlreadyRegistered(wallet);
        if (bytes(name).length == 0)        revert EmptyName();
        if (!_validCategory(category))      revert InvalidCategory();

        isBuilder[wallet] = true;
        builders[wallet] = BuilderInfo({
            name:         name,
            url:          url,
            category:     category,
            registeredAt: block.timestamp,
            active:       true
        });
        _builderList.push(wallet);

        emit BuilderRegistered(wallet, name, category, block.timestamp);
    }

    /**
     * @notice Remove a builder. Only callable by Governance.
     */
    function removeBuilder(address wallet) external onlyOwner {
        if (!isBuilder[wallet]) revert NotRegistered(wallet);

        isBuilder[wallet] = false;
        builders[wallet].active = false;

        emit BuilderRemoved(wallet, block.timestamp);
    }

    /**
     * @notice Update builder metadata. Only callable by Governance.
     */
    function updateBuilder(
        address wallet,
        string calldata name,
        string calldata url,
        string calldata category
    ) external onlyOwner {
        if (!isBuilder[wallet])         revert NotRegistered(wallet);
        if (bytes(name).length == 0)    revert EmptyName();
        if (!_validCategory(category))  revert InvalidCategory();

        builders[wallet].name     = name;
        builders[wallet].url      = url;
        builders[wallet].category = category;

        emit BuilderUpdated(wallet, name, url, category);
    }

    // ── View Functions ────────────────────────────────

    /**
     * @notice Get total number of ever-registered builders (including removed).
     */
    function getBuilderCount() external view returns (uint256) {
        return _builderList.length;
    }

    /**
     * @notice Get builder wallet address at index.
     */
    function getBuilderAt(uint256 index) external view returns (address) {
        return _builderList[index];
    }

    /**
     * @notice Get all active builders.
     */
    function getActiveBuilders() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _builderList.length; i++) {
            if (isBuilder[_builderList[i]]) count++;
        }
        address[] memory active = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < _builderList.length; i++) {
            if (isBuilder[_builderList[i]]) active[j++] = _builderList[i];
        }
        return active;
    }

    /**
     * @notice Get full builder info.
     */
    function getBuilderInfo(address wallet)
        external view returns (BuilderInfo memory)
    {
        return builders[wallet];
    }

    // ── Internal ──────────────────────────────────────

    function _validCategory(string calldata cat) internal pure returns (bool) {
        bytes32 h = keccak256(bytes(cat));
        return h == CAT_CREATOR || h == CAT_INTEGRATION ||
               h == CAT_TOOLING || h == CAT_DAO;
    }
}
