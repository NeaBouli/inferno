// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title InfernoToken
 * @notice ERC20-kompatibler Token mit deflationärer Gebührenlogik.
 *         Gebühren werden bei jedem Transfer erhoben und teilweise verbrannt.
 */
contract InfernoToken is ERC20, Ownable {
    uint8 private constant _TOKEN_DECIMALS = 9;
    uint256 private constant _INITIAL_SUPPLY =
        1_000_000_000 * 10 ** uint256(_TOKEN_DECIMALS);

    uint256 private constant FEE_DENOMINATOR = 10_000;
    uint256 private constant SENDER_BURN_FEE = 200;    // 2.0 %
    uint256 private constant RECIPIENT_BURN_FEE = 50;  // 0.5 %
    uint256 private constant POOL_FEE = 100;           // 1.0 %

    mapping(address => bool) public isFeeExempt;
    address private _poolFeeAddress;

    event SenderBurn(address indexed account, uint256 amount);
    event RecipientBurn(address indexed account, uint256 amount);
    event PoolFeeTransferred(address indexed from, address indexed pool, uint256 amount);

    /**
     * @dev Setzt den Token-Namen/Symbol, Owner sowie die anfängliche Pool-Adresse
     *      und mintet den vollen Supply an den Owner.
     * @param poolFeeAddress_ Adresse, die die Pool-Gebühren (Treasury) erhält.
     */
    constructor(address poolFeeAddress_) ERC20("Inferno", "IFR") Ownable(msg.sender) {
        require(poolFeeAddress_ != address(0), "InfernoToken: pool fee address is zero");

        _poolFeeAddress = poolFeeAddress_;

        _mint(_msgSender(), _INITIAL_SUPPLY);

        // Owner und Treasury standardmäßig gebührenfrei stellen.
        isFeeExempt[_msgSender()] = true;
        isFeeExempt[_poolFeeAddress] = true;
    }

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return _TOKEN_DECIMALS;
    }

    /**
     * @notice Gibt die aktuelle Pool-Fee-Adresse zurück.
     */
    function poolFeeAddress() external view returns (address) {
        return _poolFeeAddress;
    }

    /**
     * @notice Setzt oder entfernt die Gebührenbefreiung für eine Adresse.
     * @dev Nur vom Owner aufrufbar.
     */
    function setFeeExempt(address account, bool status) external onlyOwner {
        isFeeExempt[account] = status;
    }

    /**
     * @notice Aktualisiert die Pool-Fee-Adresse.
     * @dev Neue Adresse wird automatisch gebührenbefreit.
     */
    function setPoolFeeAddress(address newPoolFeeAddress) external onlyOwner {
        require(newPoolFeeAddress != address(0), "InfernoToken: pool fee address is zero");
        _poolFeeAddress = newPoolFeeAddress;
        isFeeExempt[newPoolFeeAddress] = true;
    }

    /**
     * @dev Interner Hook zur Implementierung der Gebührenlogik.
     *      Bei gebührenbefreiten Adressen sowie Mint/Burn findet kein Abzug statt.
     */
    function _update(address from, address to, uint256 value) internal override {
        if (
            from == address(0) ||
            to == address(0) ||
            isFeeExempt[from] ||
            isFeeExempt[to]
        ) {
            super._update(from, to, value);
            return;
        }

        uint256 senderBurn = (value * SENDER_BURN_FEE) / FEE_DENOMINATOR;
        uint256 recipientBurn = (value * RECIPIENT_BURN_FEE) / FEE_DENOMINATOR;
        uint256 poolFee = (value * POOL_FEE) / FEE_DENOMINATOR;

        uint256 amountAfterSenderFees = value - senderBurn - poolFee;

        if (senderBurn > 0) {
            super._update(from, address(0), senderBurn);
            emit SenderBurn(from, senderBurn);
        }

        if (poolFee > 0) {
            super._update(from, _poolFeeAddress, poolFee);
            emit PoolFeeTransferred(from, _poolFeeAddress, poolFee);
        }

        super._update(from, to, amountAfterSenderFees);

        if (recipientBurn > 0) {
            super._update(to, address(0), recipientBurn);
            emit RecipientBurn(to, recipientBurn);
        }
    }
}
