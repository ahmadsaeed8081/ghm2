// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface ISafetyNetVault {
    function protocolExecuteRestitution(address recipient, uint256 amount) external;
    function protocolExecuteManagerSurplus(address manager, uint256 amount) external;
    function triggerDormantEmergencyState() external;
    function claimEmergencyRelief() external;
    function sweepSurplusToOperations() external;
}

contract GHM21Protocol {
    struct Node {
        address upliner;
        uint256 currentTier;
        uint256 totalPHProvided;
        uint256 totalGHReceived;
        uint256 cycleStep;          // 1 = Initial Entry, 2 = Recommit 1, 3 = Recommit 2
        uint256 cooldownExpiry;     // 5-Hour Cooldown timestamp
        uint256 pendingBalance;     // Total remaining Get Help entitlement
        bool isGraduated;           // Sunflower School SBT status
        bool isPaused;              // Emergency account pause
        bool hasProvidedHelp;       // Handshake / Active cycle tracker
        bool isActive;              // Registered & active node
        bool hasPendingLOH;         // Strict on-chain LOH block flag (triggered on ANY payout)
    }

    struct NodeExtended {
        uint256 originalBaselineTier; 
        uint256 activeWindowExpiry;   
        uint256 activeSliceNeed;      
        uint256 directCount;          
        uint256 directVolume;         
        uint8 rank;                   
        uint8 verifiedPillarsCount;   
        bool isInQueue;               
        uint8 currentLane;            
        bool hasClaimedRestitution;   
    }

    struct TaskSubmission {
        address performer;
        string taskTitle;
        string proofLink;
        uint256 tipCount;
        uint256 totalTipsCollected;
        bool isVerified;
    }

    uint256 public constant LIFETIME_VOLUME_CAP = 21_000_000 * 10**18;
    uint256 public constant MAX_TRANCHE_BLOCK   = 100 * 10**18;
    uint256 public constant MIN_ENTRY_TIER      = 20 * 10**18;  
    uint256 public constant MIN_RECOMMIT_TIER   = 10 * 10**18;  
    uint256 public constant LOH_FAST_PASS_FEE   = 5 * 10**18;
    uint256 public constant ACTIVENESS_WINDOW   = 30 minutes; // 30-minute sub-cycle recommitment window
    uint256 public constant CYCLE_COOLDOWN      = 5 hours;
    uint256 public constant GRACE_PERIOD        = 30 minutes;

    IERC20 public immutable usdtToken;
    address public immutable safetyNetVault;
    address public immutable operationsWallet;
    address public auditorAddress;

    bool public protocolPaused;
    bool public sunsetReached;
    uint256 public totalProtocolVolume;
    bool public managerSurplusDistributed;

    mapping(address => Node) internal nodes;
    mapping(address => NodeExtended) public nodeExt;

    address[] public newcomerQueue;
    address[] public surplusQueue;
    bool public alternateTurn = true;

    uint256 public communityTxCounter;
    uint256 public lastWhaleInterleaveTime;

    TaskSubmission[] public taskSubmissions;
    mapping(uint256 => uint8) public taskPillarType;
    mapping(uint256 => mapping(address => bool)) public hasTippedTask;

    event NodeRegistered(address indexed node, address indexed upliner);
    event ProvideHelpExecuted(address indexed donor, address indexed seeker, uint256 amount, uint256 seekerPayout);
    event PartialRequeueRecorded(address indexed seeker, uint256 remainingBalance);
    event TaskSubmitted(uint256 indexed taskId, address indexed performer, string taskTitle, string proofLink);
    event TaskTipped(uint256 indexed taskId, address indexed tipper, uint256 amountToPerformer, uint256 amountToVault);
    event TaskVerified(uint256 indexed taskId, address indexed performer);
    event AcademyGraduated(address indexed node);
    event AccountPaused(address indexed node, bool isPaused);
    event BonusBurnedToVault(address indexed missedUpliner, uint256 amount, string reason);
    event ProtocolHealthInsurancePaid(address indexed donor, uint256 feeAmount);
    event TierSteppedDown(address indexed node, uint256 oldTier, uint256 newTier);
    event SunsetActivated(uint256 totalVolume);
    event AuditorUpdated(address indexed oldAuditor, address indexed newAuditor);
    event RestitutionClaimed(address indexed participant, uint256 deficitAmount);
    event ManagerSurplusClaimed(address indexed manager, uint256 amount);
    event LOHSubmitted(address indexed node);
    event LOHFastPassUsed(address indexed node, uint256 feeAmount);

    modifier whenNotPaused() {
        require(!protocolPaused, "Protocol is globally paused");
        require(!sunsetReached, "21M Sunset Cap reached");
        _;
    }

    constructor(
        address _usdtToken,
        address _safetyNetVault,
        address _operationsWallet,
        address _auditorAddress
    ) {
        usdtToken = IERC20(_usdtToken);
        safetyNetVault = _safetyNetVault;
        operationsWallet = _operationsWallet;
        auditorAddress = _auditorAddress != address(0) ? _auditorAddress : _operationsWallet;
        lastWhaleInterleaveTime = block.timestamp;

        nodes[_operationsWallet].isActive = true;
        nodes[_operationsWallet].isGraduated = true;
        nodes[_operationsWallet].cycleStep = 1;
        nodeExt[_operationsWallet].rank = 3;
    }

    function setAuditorAddress(address _newAuditor) external {
        require(msg.sender == operationsWallet, "Only operations wallet");
        require(_newAuditor != address(0), "Invalid auditor address");
        emit AuditorUpdated(auditorAddress, _newAuditor);
        auditorAddress = _newAuditor;
    }

    function registerNode(address _upliner) external whenNotPaused {
        Node storage node = nodes[msg.sender];
        require(!node.isActive, "Node already registered");
        require(_upliner != msg.sender, "Cannot refer yourself");

        if (_upliner != address(0) && (nodes[_upliner].isActive || _upliner == operationsWallet)) {
            node.upliner = _upliner;
        } else {
            node.upliner = operationsWallet;
        }

        node.isActive = true;
        node.cycleStep = 1;
        nodeExt[node.upliner].directCount += 1;

        emit NodeRegistered(msg.sender, node.upliner);
    }

    function submitLetterOfHappiness() external {
        require(nodes[msg.sender].hasPendingLOH, "No pending LOH requirement");
        _clearPendingLOH(msg.sender);
        emit LOHSubmitted(msg.sender);
    }

    function _clearPendingLOH(address _nodeAddress) internal {
        Node storage node = nodes[_nodeAddress];
        NodeExtended storage ext = nodeExt[_nodeAddress];
        node.hasPendingLOH = false;

        // Match normal LOH completion: re-enter the surplus queue when there
        // is an unpaid balance and this node is not already queued.
        if (node.pendingBalance > 0 && !ext.isInQueue) {
            if (ext.activeSliceNeed == 0) {
                ext.activeSliceNeed = node.pendingBalance > MAX_TRANCHE_BLOCK
                    ? MAX_TRANCHE_BLOCK
                    : node.pendingBalance;
            }
            surplusQueue.push(_nodeAddress);
            ext.isInQueue = true;
            ext.currentLane = 2;
        }
    }

    function provideHelp(uint256 _amount, uint256 /*_unusedParam*/) external whenNotPaused {
        Node storage donor = nodes[msg.sender];
        NodeExtended storage ext = nodeExt[msg.sender];

        require(!donor.hasPendingLOH, "PH Locked: Must submit Letter of Happiness first");

        if (!donor.isActive) {
            require(_amount >= MIN_ENTRY_TIER, "New nodes require $20 min PH");
            donor.upliner = operationsWallet;
            donor.isActive = true;
            donor.cycleStep = 1;
            nodeExt[operationsWallet].directCount += 1;
            emit NodeRegistered(msg.sender, operationsWallet);
        } else {
            require(_amount >= MIN_RECOMMIT_TIER, "Recommit requires $10 min PH");
        }
        require(!donor.isPaused, "Account is paused");

        bool isTopUp = false;
        bool isRecommitment = false;
        bool isStepDown = false;

        if (donor.pendingBalance > 0) {
            require(_amount <= (ext.originalBaselineTier * 25) / 10, "Top-up exceeds 2.5x Anti-Whale ceiling");
            isTopUp = true;
            donor.currentTier = _amount;
        } else {
            if (donor.cooldownExpiry > 0) {
                require(block.timestamp >= donor.cooldownExpiry, "5-Hour Cooldown active");
                if (block.timestamp > donor.cooldownExpiry + GRACE_PERIOD) {
                    donor.hasProvidedHelp = false;
                }
                donor.cooldownExpiry = 0;
            }

            if (ext.activeWindowExpiry > 0 && block.timestamp > ext.activeWindowExpiry) {
                donor.hasProvidedHelp = false;
                ext.activeWindowExpiry = 0;
            }

            if (donor.cycleStep == 1) {
                require(_amount % (10 * 10**18) == 0, "Fresh entries require round figures (multiples of $10)");
                if (ext.originalBaselineTier == 0) {
                    ext.originalBaselineTier = _amount;
                    donor.currentTier = _amount;
                } else {
                    require(_amount >= ext.originalBaselineTier, "Handshake Rule: Must be >= previous base tier");
                    require(_amount <= (ext.originalBaselineTier * 25) / 10, "Exceeds 2.5x Anti-Whale ceiling");
                    ext.originalBaselineTier = _amount;
                    donor.currentTier = _amount;
                }
            } else {
                isRecommitment = true;
                uint256 expectedRecommit = donor.currentTier / 2;
                if (expectedRecommit < MIN_RECOMMIT_TIER) expectedRecommit = MIN_RECOMMIT_TIER;

                if (_amount < expectedRecommit) {
                    isStepDown = true;
                    emit TierSteppedDown(msg.sender, donor.currentTier, _amount);
                    donor.currentTier = _amount;
                    ext.originalBaselineTier = _amount;
                } else {
                    require(_amount <= (ext.originalBaselineTier * 25) / 10, "Exceeds 2.5x Anti-Whale ceiling");
                }
            }
        }

        require(usdtToken.transferFrom(msg.sender, address(this), _amount), "USDT PH transfer failed");
        totalProtocolVolume += _amount;

        uint256 principalForMatrix = _amount;
        if (isRecommitment && !isStepDown) {
            principalForMatrix = _processProtocolHealthInsurance(msg.sender, _amount);
        }

        donor.totalPHProvided += _amount;
        donor.hasProvidedHelp = true;
        ext.activeWindowExpiry = 0;
        if (donor.upliner != address(0)) {
            nodeExt[donor.upliner].directVolume += _amount;
            _updateLeadershipRank(donor.upliner);
        }

        _distributeStandardMatrix(msg.sender, principalForMatrix);

        uint256 seekerAllocation = (principalForMatrix * 65) / 100;
        _dispatchAndQueue(msg.sender, _amount, seekerAllocation, isTopUp, isRecommitment);

        if (totalProtocolVolume >= LIFETIME_VOLUME_CAP && !sunsetReached) {
            sunsetReached = true;
            protocolPaused = true;
            emit SunsetActivated(totalProtocolVolume);
        }
    }

    function _processProtocolHealthInsurance(address _donor, uint256 _amount) internal returns (uint256) {
        uint256 fee = (_amount * 8) / 100;
        uint256 principal = _amount;

        if (usdtToken.allowance(_donor, address(this)) >= fee && usdtToken.balanceOf(_donor) >= fee) {
            require(usdtToken.transferFrom(_donor, address(this), fee), "Insurance fee transfer failed");
            totalProtocolVolume += fee;
        } else {
            principal = _amount - fee;
        }

        uint256 quarterFee = fee / 4;
        uint256 vaultRemainder = fee - (quarterFee * 3);

        address inviter = nodes[_donor].upliner;
        if (_isNodeBonusEligible(inviter, 1)) {
            usdtToken.transfer(inviter, quarterFee);
        } else {
            vaultRemainder += quarterFee;
        }

        address genUpliner = inviter != address(0) ? nodes[inviter].upliner : address(0);
        if (_isNodeBonusEligible(genUpliner, 2)) {
            usdtToken.transfer(genUpliner, quarterFee);
        } else {
            vaultRemainder += quarterFee;
        }

        usdtToken.transfer(operationsWallet, quarterFee);
        usdtToken.transfer(safetyNetVault, vaultRemainder);

        emit ProtocolHealthInsurancePaid(_donor, fee);
        return principal;
    }

    function _distributeStandardMatrix(address _donor, uint256 _principal) internal {
        uint256 rebate      = (_principal * 15) / 100;
        uint256 l1Bonus     = (_principal * 10) / 100;
        uint256 l2Bonus     = (_principal * 4) / 100;
        uint256 l3_5Bonus   = (_principal * 1) / 100;
        uint256 opsShare    = (_principal * 2) / 100;
        uint256 vaultShare  = (_principal * 1) / 100;

        usdtToken.transfer(_donor, rebate);
        usdtToken.transfer(operationsWallet, opsShare);

        uint256 totalToVault = vaultShare;
        address currentUpline = nodes[_donor].upliner;

        for (uint8 level = 1; level <= 5; level++) {
            uint256 levelReward = (level == 1) ? l1Bonus : (level == 2 ? l2Bonus : l3_5Bonus);

            if (currentUpline != address(0) && _isNodeBonusEligible(currentUpline, level)) {
                usdtToken.transfer(currentUpline, levelReward);
            } else {
                totalToVault += levelReward;
                emit BonusBurnedToVault(currentUpline, levelReward, "Upline inactive, unranked, or pending LOH");
            }

            if (currentUpline != address(0)) {
                currentUpline = nodes[currentUpline].upliner;
            }
        }

        usdtToken.transfer(safetyNetVault, totalToVault);
    }

    function _dispatchAndQueue(
        address _donor,
        uint256 _rawAmount,
        uint256 _seekerAllocation,
        bool _isTopUp,
        bool _isRecommitment
    ) internal {
        uint256 remainingToDispatch = _seekerAllocation;
        address firstMatchedSeeker = address(0);

        communityTxCounter += 1;
        if (communityTxCounter >= 10 || block.timestamp >= lastWhaleInterleaveTime + 15 minutes) {
            alternateTurn = false;
            communityTxCounter = 0;
            lastWhaleInterleaveTime = block.timestamp;
        }

        uint256 maxIterations = newcomerQueue.length + surplusQueue.length;
        uint256 loops = 0;

        while (remainingToDispatch > 0 && (newcomerQueue.length > 0 || surplusQueue.length > 0) && loops < maxIterations) {
            loops++;
            (address activeSeeker, uint8 laneUsed) = _peekNextSeeker();
            if (activeSeeker == address(0) || activeSeeker == _donor) {
                break;
            }

            if (nodes[activeSeeker].hasPendingLOH) {
                _popFromLane(laneUsed);
                continue;
            }

            if (firstMatchedSeeker == address(0)) {
                firstMatchedSeeker = activeSeeker;
            }

            Node storage seeker = nodes[activeSeeker];
            NodeExtended storage sExt = nodeExt[activeSeeker];

            if (sExt.activeSliceNeed == 0) {
                sExt.activeSliceNeed = seeker.pendingBalance > MAX_TRANCHE_BLOCK
                    ? MAX_TRANCHE_BLOCK
                    : seeker.pendingBalance;
            }

            uint256 currentNeed = sExt.activeSliceNeed;

            if (remainingToDispatch >= currentNeed) {
                remainingToDispatch -= currentNeed;
                usdtToken.transfer(activeSeeker, currentNeed);
                seeker.totalGHReceived += currentNeed;

                seeker.hasPendingLOH = true;

                if (seeker.pendingBalance >= currentNeed) {
                    seeker.pendingBalance -= currentNeed;
                } else {
                    seeker.pendingBalance = 0;
                }
                sExt.activeSliceNeed = 0;

                _popFromLane(laneUsed);
                alternateTurn = !alternateTurn;

                // Pull seeker completely out of queue until LOH is submitted
                sExt.isInQueue = false;
                sExt.currentLane = 0;

                if (seeker.pendingBalance == 0) {
                    _advanceSeekerCycleState(activeSeeker);
                }
                emit PartialRequeueRecorded(activeSeeker, seeker.pendingBalance);
            } else {
                uint256 partialPay = remainingToDispatch;
                remainingToDispatch = 0;

                usdtToken.transfer(activeSeeker, partialPay);
                seeker.totalGHReceived += partialPay;
                seeker.pendingBalance -= partialPay;
                sExt.activeSliceNeed -= partialPay;

                seeker.hasPendingLOH = true;

                _popFromLane(laneUsed);
                alternateTurn = !alternateTurn;

                // Pull seeker completely out of queue until LOH is submitted
                sExt.isInQueue = false;
                sExt.currentLane = 0;

                emit PartialRequeueRecorded(activeSeeker, seeker.pendingBalance);
            }
        }

        if (remainingToDispatch > 0) {
            usdtToken.transfer(safetyNetVault, remainingToDispatch);
        }

        Node storage donorNode = nodes[_donor];
        NodeExtended storage dExt = nodeExt[_donor];

        // Remainder-Absorption Logic: Combine new seeker allocation with existing unfulfilled dust remainder, capped at MAX_TRANCHE_BLOCK
        uint256 combinedListing = _seekerAllocation + donorNode.pendingBalance;
        donorNode.pendingBalance = combinedListing;

        if (dExt.activeSliceNeed == 0) {
            dExt.activeSliceNeed = donorNode.pendingBalance > MAX_TRANCHE_BLOCK
                ? MAX_TRANCHE_BLOCK
                : donorNode.pendingBalance;
        }

        if (!_isTopUp && !dExt.isInQueue) {
            if (!_isRecommitment && _rawAmount <= MAX_TRANCHE_BLOCK) {
                newcomerQueue.push(_donor);
                dExt.currentLane = 1;
            } else {
                surplusQueue.push(_donor);
                dExt.currentLane = 2;
            }
            dExt.isInQueue = true;
        }

        emit ProvideHelpExecuted(_donor, firstMatchedSeeker, _rawAmount, _seekerAllocation);
    }

    function _advanceSeekerCycleState(address _seeker) internal {
        Node storage seeker = nodes[_seeker];
        NodeExtended storage sExt = nodeExt[_seeker];

        if (seeker.cycleStep < 3) {
            seeker.cycleStep += 1;
            sExt.activeWindowExpiry = block.timestamp + ACTIVENESS_WINDOW;
        } else {
            seeker.cycleStep = 1;
            seeker.cooldownExpiry = block.timestamp + CYCLE_COOLDOWN;
            sExt.activeWindowExpiry = 0;
        }
    }

    function _peekNextSeeker() internal view returns (address, uint8) {
        if (alternateTurn) {
            if (newcomerQueue.length > 0) return (newcomerQueue[0], 1);
            if (surplusQueue.length > 0)  return (surplusQueue[0], 2);
        } else {
            if (surplusQueue.length > 0)  return (surplusQueue[0], 2);
            if (newcomerQueue.length > 0) return (newcomerQueue[0], 1);
        }
        return (address(0), 0);
    }

    function _popFromLane(uint8 _lane) internal {
        if (_lane == 1 && newcomerQueue.length > 0) {
            for (uint256 i = 0; i < newcomerQueue.length - 1; i++) {
                newcomerQueue[i] = newcomerQueue[i + 1];
            }
            newcomerQueue.pop();
        } else if (_lane == 2 && surplusQueue.length > 0) {
            for (uint256 i = 0; i < surplusQueue.length - 1; i++) {
                surplusQueue[i] = surplusQueue[i + 1];
            }
            surplusQueue.pop();
        }
    }

    function _isNodeBonusEligible(address _node, uint8 _level) internal view returns (bool) {
        if (_node == address(0)) return false;
        if (_node == operationsWallet) return true;

        Node storage n = nodes[_node];
        NodeExtended storage e = nodeExt[_node];

        if (!n.isActive || n.isPaused || !n.hasProvidedHelp || n.hasPendingLOH) return false;
        if (e.activeWindowExpiry > 0 && block.timestamp > e.activeWindowExpiry) return false;
        if (n.cooldownExpiry > 0 && block.timestamp > n.cooldownExpiry + GRACE_PERIOD) return false;

        if (_level >= 3 && !n.isGraduated) return false;
        if (_level == 3 && e.rank < 1) return false;
        if (_level == 4 && e.rank < 2) return false;
        if (_level == 5 && e.rank < 3) return false;

        return true;
    }

    function _updateLeadershipRank(address _node) internal {
        Node storage n = nodes[_node];
        NodeExtended storage e = nodeExt[_node];
        if (!n.isGraduated) return;

        if (e.directCount >= 10 && e.directVolume >= 2000 * 10**18 && e.verifiedPillarsCount >= 4) {
            e.rank = 3;
        } else if (e.directCount >= 5 && e.directVolume >= 1000 * 10**18 && e.verifiedPillarsCount >= 2) {
            e.rank = 2;
        } else if (e.directCount >= 2 && e.directVolume >= 200 * 10**18 && e.verifiedPillarsCount >= 1) {
            e.rank = 1;
        }
    }

    // --- Safety Net Vault Emergency & Sweep Proxy Functions ---

    function triggerDormantEmergencyState() external {
        ISafetyNetVault(safetyNetVault).triggerDormantEmergencyState();
    }

    function claimEmergencyRelief() external {
        ISafetyNetVault(safetyNetVault).claimEmergencyRelief();
    }

    function sweepSurplusToOperations() external {
        require(msg.sender == operationsWallet, "Only operations wallet");
        ISafetyNetVault(safetyNetVault).sweepSurplusToOperations();
    }

    // --- Sunset Restitution & Surplus Claims ---

    function claimRestitution() external {
        require(sunsetReached, "Sunset cap not yet reached");
        Node storage seekerNode = nodes[msg.sender];
        NodeExtended storage seekerExt = nodeExt[msg.sender];
        
        require(seekerNode.isActive, "Not an active node");
        require(!seekerExt.hasClaimedRestitution, "Restitution already claimed");
        require(seekerNode.totalGHReceived < seekerNode.totalPHProvided, "Net-positive earners excluded");

        uint256 deficit = seekerNode.totalPHProvided - seekerNode.totalGHReceived;
        seekerExt.hasClaimedRestitution = true;

        ISafetyNetVault(safetyNetVault).protocolExecuteRestitution(msg.sender, deficit);
        emit RestitutionClaimed(msg.sender, deficit);
    }

    function distributeManagerSurplus(address[] calldata _managers, uint256[] calldata _amounts) external {
        require(msg.sender == operationsWallet, "Only operations wallet");
        require(sunsetReached, "Sunset cap not yet reached");
        require(!managerSurplusDistributed, "Manager surplus already distributed");
        require(_managers.length == _amounts.length, "Mismatched arrays");

        managerSurplusDistributed = true;

        for (uint256 i = 0; i < _managers.length; i++) {
            address mgr = _managers[i];
            uint256 amt = _amounts[i];
            require(nodeExt[mgr].rank == 3, "Not a qualified Manager (Rank 3)");

            ISafetyNetVault(safetyNetVault).protocolExecuteManagerSurplus(mgr, amt);
            emit ManagerSurplusClaimed(mgr, amt);
        }
    }

    // --- Tasks, School & Administration ---

    function submitTask(string memory _taskTitle, string memory _proofLink) external whenNotPaused {
        uint256 newTaskId = taskSubmissions.length;
        taskSubmissions.push(TaskSubmission({
            performer: msg.sender,
            taskTitle: _taskTitle,
            proofLink: _proofLink,
            tipCount: 0,
            totalTipsCollected: 0,
            isVerified: false
        }));

        uint8 pillar = 1;
        bytes memory titleBytes = bytes(_taskTitle);
        if (titleBytes.length >= 8) {
            if (titleBytes[7] == "2") pillar = 2;
            else if (titleBytes[7] == "3") pillar = 3;
            else if (titleBytes[7] == "4") pillar = 4;
        }
        taskPillarType[newTaskId] = pillar;

        emit TaskSubmitted(newTaskId, msg.sender, _taskTitle, _proofLink);
    }

    function tipTask(uint256 _taskId, uint256 _amount) external whenNotPaused {
        require(_taskId < taskSubmissions.length, "Invalid task ID");
        require(_amount > 0, "Tip must be > 0");
        TaskSubmission storage sub = taskSubmissions[_taskId];
        require(sub.performer != msg.sender, "Strict self-tipping prevention");
        require(!hasTippedTask[_taskId][msg.sender], "Already tipped this task");

        require(usdtToken.transferFrom(msg.sender, address(this), _amount), "Tip transfer failed");

        uint256 toPerformer = (_amount * 70) / 100;
        uint256 toVault = _amount - toPerformer;

        usdtToken.transfer(sub.performer, toPerformer);
        usdtToken.transfer(safetyNetVault, toVault);

        sub.tipCount += 1;
        sub.totalTipsCollected += _amount;
        hasTippedTask[_taskId][msg.sender] = true;

        emit TaskTipped(_taskId, msg.sender, toPerformer, toVault);
    }

    function verifyTask(uint256 _taskId) external {
        require(msg.sender == auditorAddress || msg.sender == operationsWallet, "Only auditor");
        require(_taskId < taskSubmissions.length, "Invalid task ID");
        TaskSubmission storage sub = taskSubmissions[_taskId];
        require(!sub.isVerified, "Already verified");

        uint8 pillar = taskPillarType[_taskId];
        uint256 requiredTips = 3;
        if (pillar == 2) requiredTips = 5;
        else if (pillar == 3) requiredTips = 7;
        else if (pillar == 4) requiredTips = 10;

        require(sub.tipCount >= requiredTips, "Tip threshold not met");

        sub.isVerified = true;
        nodeExt[sub.performer].verifiedPillarsCount += 1;
        _updateLeadershipRank(sub.performer);

        emit TaskVerified(_taskId, sub.performer);
    }

    function autoGraduateSchool() external whenNotPaused {
        nodes[msg.sender].isGraduated = true;
        _updateLeadershipRank(msg.sender);
        emit AcademyGraduated(msg.sender);
    }

    function payFastPass(uint256 _feeAmount, string memory _purpose) external whenNotPaused {
        require(_feeAmount > 0, "Fee must be > 0");
        bytes32 pHash = keccak256(bytes(_purpose));
        bool isLOHFastPass = pHash == keccak256(bytes("LOH_FAST_PASS"));
        if (isLOHFastPass) {
            require(_feeAmount == LOH_FAST_PASS_FEE, "LOH Fast Pass fee must be $5");
            require(nodes[msg.sender].hasPendingLOH, "No pending LOH requirement");
        }
        require(usdtToken.transferFrom(msg.sender, safetyNetVault, _feeAmount), "Fast pass transfer failed");

        if (isLOHFastPass) {
            _clearPendingLOH(msg.sender);
            emit LOHFastPassUsed(msg.sender, _feeAmount);
        } else if (pHash == keccak256(bytes("EMERGENCY_GRACE_1H"))) {
            if (nodeExt[msg.sender].activeWindowExpiry > 0) {
                nodeExt[msg.sender].activeWindowExpiry += 30 minutes;
            }
            if (nodes[msg.sender].cooldownExpiry > 0) {
                nodes[msg.sender].cooldownExpiry += 30 minutes;
            }
        } else if (pHash == keccak256(bytes("BUNDLE_FAST_PASS"))) {
            nodeExt[msg.sender].verifiedPillarsCount = 4;
            _updateLeadershipRank(msg.sender);
        } else {
            nodeExt[msg.sender].verifiedPillarsCount += 1;
            _updateLeadershipRank(msg.sender);
        }
    }

    function toggleAccountPause() external {
        Node storage node = nodes[msg.sender];
        node.isPaused = !node.isPaused;
        emit AccountPaused(msg.sender, node.isPaused);
    }

    function setProtocolGlobalPause(bool _paused) external {
        require(msg.sender == operationsWallet, "Only operations wallet");
        protocolPaused = _paused;
    }

    function fifoQueue(uint256 _index) external view returns (address) {
        uint256 totalLen = newcomerQueue.length + surplusQueue.length;
        require(_index < totalLen, "Index out of bounds");

        uint256 nIdx = 0;
        uint256 sIdx = 0;
        bool turn = alternateTurn;

        for (uint256 i = 0; i <= _index; i++) {
            address picked;
            if (turn) {
                if (nIdx < newcomerQueue.length) {
                    picked = newcomerQueue[nIdx++];
                } else {
                    picked = surplusQueue[sIdx++];
                }
            } else {
                if (sIdx < surplusQueue.length) {
                    picked = surplusQueue[sIdx++];
                } else {
                    picked = newcomerQueue[nIdx++];
                }
            }
            turn = !turn;
            if (i == _index) return picked;
        }
        return address(0);
    }

    function getQueueLength() external view returns (uint256) {
        return newcomerQueue.length + surplusQueue.length;
    }

    function getNode(address account) external view returns (Node memory) {
        return nodes[account];
    }

    function getTaskSubmissionsCount() external view returns (uint256) {
        return taskSubmissions.length;
    }
}
