import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../../context/SocketContext";
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Icon,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Radio,
  RadioGroup,
  Stack,
  Text,
  Tooltip,
  useBreakpointValue,
  useToast,
  VStack,
} from "@chakra-ui/react";
import {
  FaCheckCircle,
  FaCoins,
  FaGrinStars,
  FaBoxOpen,
  FaRegCircle,
  FaRobot,
  FaSignOutAlt,
} from "react-icons/fa";
import { GiCardDraw } from "react-icons/gi";
import { InvestmentGrid } from "./components/InvestmentGrid";
import { COMPANY_COLORS, COMPANIES } from "../../constants/game";
import CardItem from "./components/CardItem";
import {
  addBot,
  drawFromDeck,
  getStoredToken,
  kickPlayer,
  leaveRoom,
  playCard,
  readyRoom,
  startGame,
  takeFromMarket,
} from "../../services/api";
import type { GameOverEvent, PlayerView, RoomView, RoundEndEvent } from "../../types/game";

const MIN_PLAYERS = 3;

/** 从房间视图直接推导对局结果(状态驱动,防止客户端错过 game_over 事件后无终局展示) */
function deriveGameOver(v: RoomView): GameOverEvent {
  const standings = [...v.players]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.seat - b.seat)
    .map((p, i) => ({ rank: i + 1, player_id: p.name, score: p.score ?? 0, money: p.money ?? 0 }));
  return {
    winner: standings[0]?.player_id ?? "",
    total_rounds: v.total_rounds ?? 0,
    standings,
  };
}

const GamePage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected, socket, connect, disconnect } = useSocket();
  const toast = useToast();

  // 房间/身份信息:仅在页面挂载时读取一次,
  // 避免会话中途被其它标签页写入的存储值悄悄改变身份。
  // 身份存 sessionStorage(标签页隔离),多开标签页互不干扰
  const { roomId, playerName, token } = useMemo(
    () => ({
      roomId: sessionStorage.getItem("roomId") || "",
      playerName: localStorage.getItem("playerName") || "",
      token: getStoredToken(),
    }),
    [],
  );

  const [view, setView] = useState<RoomView | null>(null);
  const [roundSummary, setRoundSummary] = useState<RoundEndEvent | null>(null);
  const [gameOver, setGameOver] = useState<GameOverEvent | null>(null);
  const [totalRounds, setTotalRounds] = useState(2);
  const [selectedHandIdx, setSelectedHandIdx] = useState<number | null>(null);

  // 响应式卡牌尺寸(手机端整体缩小,保证一屏放下手牌)
  const handCardSize = useBreakpointValue({ base: 8, md: 12 }) ?? 12;
  const marketCardSize = useBreakpointValue({ base: 7, md: 10 }) ?? 10;
  const investCardSize = useBreakpointValue({ base: 4, md: 8 }) ?? 8;
  const opponentCardSize = useBreakpointValue({ base: 3.5, md: 4 }) ?? 4;

  // 连接管理:进入页面时确保 WS 连接(connect 内部按 URL/状态去重,重复调用安全),
  // 离开页面时断开——服务端按"断线宽限"移出玩家,刷新场景会在重连时取消移出。
  // 注意 setup 必须无条件调用 connect:StrictMode 的 setup→cleanup→setup
  // 双执行周期中,若 setup 依赖上一次渲染的 socket 状态,补跑时不会重连。
  useEffect(() => {
    if (roomId && playerName && token) {
      connect(roomId, playerName, token);
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 统一处理服务端推送
  useEffect(() => {
    if (!socket) return;
    const onMessage = (event: MessageEvent) => {
      let msg: { type: string; data: Record<string, unknown> };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "room_state": {
          const v = msg.data as unknown as RoomView;
          setView(v);
          // 状态兜底:即使错过了 game_over 事件(如页面刷新重连),也能展示终局
          if (v.game_status === "game_over" && v.status === "finished") {
            setGameOver((prev) => prev ?? deriveGameOver(v));
          }
          break;
        }
        case "game_started":
          toast({
            title: (msg.data as { message?: string }).message || "游戏开始!",
            status: "success",
            duration: 2000,
            position: "top",
          });
          break;
        case "action": {
          const data = msg.data as { player_id: string; message: string };
          if (data.player_id !== playerName) {
            toast({ title: data.message, status: "info", duration: 2000, position: "top" });
          }
          break;
        }
        case "round_end":
          setRoundSummary(msg.data as unknown as RoundEndEvent);
          break;
        case "game_over":
          setRoundSummary(null); // 终局弹窗顶掉回合结算弹窗,避免堆叠
          setGameOver(msg.data as unknown as GameOverEvent);
          break;
        case "room_deleted":
          toast({
            title: (msg.data as { reason?: string }).reason || "房间已解散",
            status: "warning",
            duration: 2500,
            position: "top",
          });
          disconnect();
          navigate("/");
          break;
        case "kicked":
          toast({
            title: (msg.data as { reason?: string }).reason || "你已被移出房间",
            status: "warning",
            duration: 2500,
            position: "top",
          });
          disconnect();
          navigate("/");
          break;
        default:
          break;
      }
    };
    socket.addEventListener("message", onMessage);
    // WS 被服务端以 1008 关闭:身份校验失败或已不在房间(被移出/房间已解散)。
    // 留在页面只会停在"连接中",提示后退回大厅,便于重新加入。
    const onClose = (event: CloseEvent) => {
      if (event.code === 1008) {
        toast({
          title: "连接已失效,请重新加入房间",
          status: "warning",
          duration: 2500,
          position: "top",
        });
        navigate("/");
      }
    };
    socket.addEventListener("close", onClose);
    // 请求服务端重发当前状态:WS 握手后服务端的首次推送
    // 可能早于本监听器挂载,靠主动 sync 弥补(连接中则延迟重试一次)
    const sync = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send("sync");
    };
    sync();
    const retryTimer = setTimeout(sync, 500);
    return () => {
      clearTimeout(retryTimer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
  }, [socket, toast, navigate, disconnect, playerName]);

  // ====== 派生状态 ======
  const isWaiting = !view || view.status === "waiting";
  const me: PlayerView | undefined = view?.players.find((p) => p.name === playerName);
  const opponents = view?.players.filter((p) => p.name !== playerName) ?? [];
  const market = view?.market ?? [];
  const deckCount = view?.deck_count ?? 0;
  const gameStatus = view?.game_status;
  const myTurn = !!view && gameStatus === "active" && view.current_player === playerName;

  // 回合推进/手牌变化时取消选中的手牌
  const handLen = me?.hand?.length ?? 0;
  useEffect(() => {
    setSelectedHandIdx(null);
  }, [view?.turn_phase, view?.current_player, handLen]);

  // 手牌较多时逐张加大重叠度,保证手机宽度内不溢出
  const handSpacingBase =
    handLen <= 4 ? "-24px" : `${Math.max(-56, -24 - (handLen - 4) * 12)}px`;

  const blockedCompanies = useMemo(
    () =>
      new Set(
        COMPANIES.filter((c) => me?.antimonopoly?.[String(c)]),
      ),
    [me],
  );
  const drawCost = market.filter((m) => !blockedCompanies.has(m.company)).length;
  const takeableExists = market.some((m) => !blockedCompanies.has(m.company));
  // 与后端规则一致:费用为 0、付得起,或市场无牌可拿(免费兜底)时可以抽牌
  const drawAllowed =
    myTurn &&
    view?.turn_phase === "acquire" &&
    deckCount > 0 &&
    (drawCost === 0 || (me?.money ?? 0) >= drawCost || !takeableExists);
  // 轮到获取阶段但确实无牌可获取时,允许直接出牌(牌库必空,出完即结算)
  const canPlay =
    myTurn && (view?.turn_phase === "play" || (deckCount === 0 && !takeableExists));

  // ====== 操作 ======
  const act = useCallback(
    async (fn: () => Promise<unknown>, label: string) => {
      try {
        await fn();
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        const message = error instanceof Error ? error.message : `${label}失败`;
        if (status === 403) {
          // 身份校验失败:本地会话已不可信(被顶替/房间已变动),
          // 留在页面只会反复报错,直接退回大厅重新加入
          toast({
            title: `${message},请重新加入房间`,
            status: "error",
            duration: 2500,
            position: "top",
          });
          disconnect();
          navigate("/");
          return;
        }
        toast({
          title: message,
          status: "error",
          duration: 2200,
          position: "top",
        });
      }
    },
    [toast, disconnect, navigate],
  );

  const handleExit = async () => {
    await act(() => leaveRoom(roomId, playerName), "退出房间");
    disconnect();
    navigate("/");
  };

  // 房主移出玩家(仅等待期,后端会向被移出者推送 kicked 事件)
  const handleKick = (target: string) => {
    act(() => kickPlayer(roomId, playerName, target), "移出玩家");
  };

  if (isWaiting) {
    const players = view?.players ?? [];
    const someoneOffline = players.some((p) => p.online === false);
    const nonHostPlayers = players.filter((p) => !p.is_host);
    const allReady = nonHostPlayers.length > 0 && nonHostPlayers.every((p) => p.ready);
    const canStart = players.length >= MIN_PLAYERS && allReady && !someoneOffline;
    const isHost = !!view && view.host === playerName;

    return (
      <Box
        minH="100vh"
        bg="gray.50"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <VStack spacing={8} p={10} bg="white" borderRadius="2xl" boxShadow="2xl" minW="420px" textAlign="center">
          <VStack spacing={2}>
            <Text fontSize="2xl" fontWeight="bold" color="gray.700">
              {view ? "等待游戏开启" : "连接房间中..."}
            </Text>
            <Text color="gray.500">
              {view ? "等待好友加入房间..." : "若长时间无响应,请返回大厅重新加入"}
            </Text>
          </VStack>

          <Box p={6} bg="blue.50" borderRadius="xl" borderWidth={1} borderColor="blue.100" w="full">
            <Text color="blue.600" fontSize="sm" fontWeight="bold" mb={1}>
              房间号(邀请码)
            </Text>
            <Text
              fontSize="4xl"
              fontWeight="black"
              color="blue.700"
              letterSpacing="wider"
              fontFamily="monospace"
            >
              {roomId}
            </Text>
          </Box>

          {/* 已加入玩家列表 */}
          <Box w="full">
            <Text fontSize="md" fontWeight="bold" color="gray.600" mb={3} textAlign="left">
              已加入玩家 ({players.length}/{view?.max_players ?? 7})
            </Text>
            <VStack spacing={3} align="stretch">
              {players.map((player) => (
                <Flex
                  key={player.name}
                  bg="gray.50"
                  p={3}
                  borderRadius="lg"
                  align="center"
                  justify="space-between"
                  borderWidth={1}
                  borderColor="gray.200"
                >
                  <HStack spacing={3}>
                    <Icon
                      as={player.is_bot ? FaRobot : FaGrinStars}
                      color={player.is_bot ? "purple.400" : "blue.400"}
                    />
                    <Text fontWeight="medium" color="gray.700">
                      {player.name}
                      {player.is_bot && (
                        <Badge ml={2} colorScheme="purple" variant="subtle">
                          机器人
                        </Badge>
                      )}
                      {player.is_host && (
                        <Badge ml={2} colorScheme="green" variant="subtle">
                          房主
                        </Badge>
                      )}
                      {player.name === playerName && (
                        <Badge ml={2} colorScheme="blue" variant="subtle">
                          我
                        </Badge>
                      )}
                    </Text>
                  </HStack>
                  {player.online === false ? (
                    <Badge colorScheme="gray" variant="subtle">
                      已断开
                    </Badge>
                  ) : (
                    !player.is_host && (
                      <HStack spacing={1}>
                        <Icon
                          as={player.ready ? FaCheckCircle : FaRegCircle}
                          color={player.ready ? "green.400" : "gray.300"}
                        />
                        <Text fontSize="sm" color={player.ready ? "green.500" : "gray.400"}>
                          {player.ready ? "已准备" : "等待准备"}
                        </Text>
                      </HStack>
                    )
                  )}
                  {isHost && !player.is_host && (
                    <Button
                      size="xs"
                      colorScheme="red"
                      variant="outline"
                      ml={2}
                      onClick={() => handleKick(player.name)}
                    >
                      移出
                    </Button>
                  )}
                </Flex>
              ))}
              {Array.from({ length: Math.max(0, (view?.max_players ?? 7) - players.length) }).map(
                (_, i) => (
                  <Flex
                    key={`empty-${i}`}
                    bg="transparent"
                    p={3}
                    borderRadius="lg"
                    align="center"
                    borderWidth={1}
                    borderStyle="dashed"
                    borderColor="gray.300"
                  >
                    <Text color="gray.400" fontSize="sm" ml={2}>
                      等待玩家加入...
                    </Text>
                  </Flex>
                ),
              )}
            </VStack>
          </Box>

          {isHost ? (
            <VStack w="full" spacing={4}>
              <Button
                size="sm"
                colorScheme="purple"
                variant="outline"
                w="full"
                leftIcon={<Icon as={FaRobot} />}
                isDisabled={players.length >= (view?.max_players ?? 7)}
                onClick={() => act(() => addBot(roomId, playerName), "添加机器人")}
              >
                添加机器人
              </Button>
              <HStack>
                <Text color="gray.600" fontSize="sm">
                  游戏轮数
                </Text>
                <RadioGroup value={String(totalRounds)} onChange={(v) => setTotalRounds(Number(v))}>
                  <Stack direction="row" spacing={4}>
                    <Radio value="2">2 轮</Radio>
                    <Radio value="3">3 轮</Radio>
                  </Stack>
                </RadioGroup>
              </HStack>
              <Button
                size="lg"
                colorScheme="blue"
                w="full"
                height="3.5rem"
                fontSize="lg"
                isDisabled={!canStart}
                onClick={() => act(() => startGame(roomId, playerName, totalRounds), "开始游戏")}
                boxShadow="lg"
                _hover={{ transform: "translateY(-2px)", boxShadow: "xl" }}
                transition="all 0.2s"
              >
                开始游戏
              </Button>
              <Text fontSize="xs" color="gray.400">
                {players.length < MIN_PLAYERS
                  ? `至少需要 ${MIN_PLAYERS} 名玩家才能开始`
                  : someoneOffline
                    ? "有玩家已断开,等待其重连(超时后自动移出房间)"
                    : !allReady
                      ? "等待所有玩家准备后即可开始"
                      : "所有玩家已准备,可以开始了"}
              </Text>
            </VStack>
          ) : (
            <Button
              size="lg"
              colorScheme={me?.ready ? "gray" : "green"}
              w="full"
              height="3rem"
              isDisabled={!view}
              onClick={() =>
                act(() => readyRoom(roomId, playerName, !me?.ready), "准备")
              }
            >
              {me?.ready ? "取消准备" : "准备"}
            </Button>
          )}

          <Button variant="ghost" colorScheme="red" size="sm" onClick={handleExit}>
            {isHost ? "解散并退出" : "取消并退出"}
          </Button>
        </VStack>
      </Box>
    );
  }

  // ====== 游戏主界面 ======
  const turnHint = gameOver
    ? "游戏已结束"
    : myTurn
      ? view?.turn_phase === "acquire"
        ? "你的回合:请从牌库抽牌或拿取市场卡牌"
        : "你的回合:请打出一张手牌(持股或上架)"
      : `等待 ${view?.current_player ?? "..."} 操作...`;

  const renderTokens = (p: PlayerView) =>
    COMPANIES.filter((c) => p.antimonopoly?.[String(c)]);

  return (
    // 手机端锁定为一屏高度(dvh 随浏览器工具栏伸缩),各区压缩尺寸,免滚动看全手牌
    <Box
      h={{ base: "100dvh", md: "100vh" }}
      bg="gray.50"
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      {/* 1. 顶部栏 */}
      <Flex bg="white" p={{ base: 1.5, md: 2 }} justify="space-between" align="center" boxShadow="sm">
        <HStack>
          <Text color="gray.800" fontWeight="bold">
            Room: {roomId}
          </Text>
          <Badge colorScheme="purple">
            第 {view?.round_number ?? 1}/{view?.total_rounds ?? "-"} 轮
          </Badge>
          <Badge colorScheme={isConnected ? "green" : "red"}>
            {isConnected ? "ONLINE" : "OFFLINE"}
          </Badge>
        </HStack>
        <Button
          size="xs"
          colorScheme="red"
          leftIcon={<Icon as={FaSignOutAlt} />}
          onClick={handleExit}
        >
          退出
        </Button>
      </Flex>

      {/* 回合提示条 */}
      <Center py={{ base: 1, md: 2 }} bg={myTurn ? "yellow.100" : "gray.100"} px={2}>
        <Text fontWeight="bold" color={myTurn ? "yellow.700" : "gray.500"} fontSize={{ base: "xs", md: "sm" }}>
          {turnHint}
        </Text>
      </Center>

      {/* 2. 游戏主区域 */}
      <Flex flex={1} minH={0} position="relative" p={{ base: 1.5, md: 4 }} direction="column" overflow="auto">
        {/* 对手区域(手机端横向滑动) */}
        <Flex
          justify={{ base: "flex-start", md: "center" }}
          gap={{ base: 2, md: 6 }}
          mb={{ base: 2, md: 8 }}
          wrap="nowrap"
          overflowX="auto"
          pb={1}
          sx={{
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {opponents.map((player) => {
            const active = view?.current_player === player.name;
            return (
              <VStack
                key={player.name}
                bg="white"
                p={{ base: 2, md: 5 }}
                borderRadius="md"
                borderWidth={active ? 2 : 0}
                borderColor={active ? "yellow.400" : "white"}
                boxShadow={active ? "lg" : "sm"}
                spacing={{ base: 0, md: 2 }}
                minW={{ base: "150px", md: "130px" }}
                flexShrink={0}
                justify="center"
              >
                {/* 手机端信息与投资并排压低高度,桌面端保持纵向 */}
                <Flex direction={{ base: "row", md: "column" }} align="center" gap={{ base: 3, md: 2 }}>
                  <VStack spacing={0} align={{ base: "flex-start", md: "center" }}>
                    <Text color="gray.700" fontSize="sm" fontWeight="bold">
                      {player.name}
                      {player.is_bot && (
                        <Badge ml={1} colorScheme="purple" fontSize="2xs">
                          机器人
                        </Badge>
                      )}
                      {player.online === false && (
                        <Badge ml={1} colorScheme="gray" fontSize="2xs">
                          离线
                        </Badge>
                      )}
                      {active && (
                        <Badge ml={1} colorScheme="yellow" fontSize="2xs" variant="solid">
                          行动中
                        </Badge>
                      )}
                    </Text>
                    <HStack spacing={{ base: 2, md: 3 }}>
                      <HStack spacing={1} align="center">
                        <Icon as={FaCoins} color="yellow.500" boxSize={3} />
                        <Text fontSize="xs" color="yellow.600" fontWeight="bold">
                          {player.money ?? 0}
                        </Text>
                      </HStack>
                      <Badge colorScheme="blue" fontSize="2xs">
                        {player.score ?? 0} 分
                      </Badge>
                      <Badge fontSize="2xs" color="gray.500">
                        手牌 {player.hand_count ?? 0}
                      </Badge>
                    </HStack>
                  </VStack>
                  {/* 对手投资情况 */}
                  <InvestmentGrid
                    investments={(player.investments ?? {}) as never}
                    tokens={renderTokens(player)}
                    size={opponentCardSize}
                  />
                </Flex>
              </VStack>
            );
          })}
        </Flex>

        {/* 中央桌面 (市场 & 牌堆) */}
        <Flex
          flex={1}
          minH={0}
          justify="center"
          align="center"
          direction="column"
          gap={{ base: 2, md: 8 }}
          py={{ base: 1, md: 0 }}
        >
          <HStack
            spacing={{ base: 3, md: 12 }}
            align="center"
            wrap="wrap"
            justify="center"
            w={{ base: "full", md: "auto" }}
          >
            {/* 牌堆 */}
            <VStack>
              <Box
                w={{ base: "14", md: "28" }}
                h={{ base: "20", md: "40" }}
                bg="blue.700"
                borderRadius="lg"
                borderWidth={{ base: 2, md: 4 }}
                borderColor="white"
                boxShadow="xl"
                position="relative"
                transition="all 0.2s"
              >
                <Center h="full">
                  <Icon as={GiCardDraw} boxSize={{ base: 8, md: 16 }} color="whiteAlpha.800" />
                </Center>
                <Badge
                  position="absolute"
                  top="-2"
                  right="-2"
                  bg="red.500"
                  color="white"
                  fontSize={{ base: "sm", md: "lg" }}
                  borderRadius="full"
                  w={{ base: 6, md: 8 }}
                  h={{ base: 6, md: 8 }}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  boxShadow="md"
                >
                  {deckCount}
                </Badge>
              </Box>
              <Tooltip
                label={
                  drawCost === 0
                    ? "市场无公开卡牌,免费抽取"
                    : `需向市场每张公开卡牌支付 1 元(共 ${drawCost} 元)`
                }
                isDisabled={!drawAllowed}
                hasArrow
              >
                <Button
                  size="sm"
                  colorScheme="blue"
                  variant="outline"
                  isDisabled={!drawAllowed}
                  onClick={() => act(() => drawFromDeck(roomId, playerName), "抽牌")}
                >
                  抽牌{drawCost > 0 ? ` (-${drawCost} 金币)` : " (免费)"}
                </Button>
              </Tooltip>
            </VStack>

            {/* 市场(手机端单行横向滑动,避免换行挤压布局) */}
            <HStack
              p={{ base: 2, md: 6 }}
              bg="white"
              borderRadius="3xl"
              boxShadow="lg"
              borderWidth={1}
              borderColor="gray.200"
              borderStyle="solid"
              w={{ base: "full", md: "auto" }}
              minW={0}
              minH={{ base: "96px", md: "200px" }}
              justify={{ base: "flex-start", md: "center" }}
              wrap={{ base: "nowrap", md: "wrap" }}
              gap={{ base: 2, md: 4 }}
              overflowX={{ base: "auto", md: "visible" }}
              sx={{
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
                "& > *": { flexShrink: 0 },
              }}
            >
              {market.length === 0 && (
                <VStack spacing={1}>
                  <Icon as={FaBoxOpen} boxSize={{ base: 5, md: 8 }} color="gray.300" />
                  <Text color="gray.400" fontSize={{ base: "xs", md: "sm" }}>
                    市场空空如也
                  </Text>
                </VStack>
              )}
              {market.map((card, index) => {
                const blocked = blockedCompanies.has(card.company);
                const takeAllowed = myTurn && view?.turn_phase === "acquire" && !blocked;
                return (
                  <VStack key={`${card.company}-${index}`} position="relative">
                    <Tooltip
                      label={
                        blocked
                          ? `你持有公司 ${card.company} 的反垄断标记,不能拿取`
                          : `点击拿取(获得 ${card.coins_on_top} 金币)`
                      }
                      hasArrow
                    >
                      <Box
                        cursor={takeAllowed ? "pointer" : "not-allowed"}
                        opacity={blocked ? 0.45 : 1}
                        _hover={
                          takeAllowed ? { transform: "scale(1.05)", boxShadow: "xl" } : undefined
                        }
                        transition="all 0.2s"
                        position="relative"
                        onClick={
                          takeAllowed
                            ? () => act(() => takeFromMarket(roomId, playerName, index), "拿牌")
                            : undefined
                        }
                      >
                        <CardItem company={card.company} size={marketCardSize} />
                        {card.coins_on_top > 0 && (
                          <Badge
                            position="absolute"
                            height={{ base: "1.75rem", md: "2.5rem" }}
                            width={{ base: "1.75rem", md: "2.5rem" }}
                            top="-2"
                            right="-2"
                            bg="yellow.400"
                            fontSize={{ base: "sm", md: "large" }}
                            borderRadius="full"
                            p={0}
                            boxShadow="md"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            fontWeight="bold"
                            color="white"
                          >
                            {card.coins_on_top}
                          </Badge>
                        )}
                      </Box>
                    </Tooltip>
                  </VStack>
                );
              })}
            </HStack>
          </HStack>
        </Flex>

        {/* 3. 玩家区域 (底部,手机端纵向堆叠) */}
        <Flex
          mt="auto"
          bg="white"
          borderTopRadius="3xl"
          p={{ base: 2, md: 6 }}
          gap={{ base: 2, md: 8 }}
          align={{ base: "center", md: "end" }}
          justify="center"
          direction={{ base: "column", md: "row" }}
          boxShadow="0 -4px 20px rgba(0,0,0,0.05)"
        >
          {/* 我的状态与投资 */}
          <VStack align={{ base: "center", md: "start" }} spacing={{ base: 1, md: 4 }} flex={1} w={{ base: "full", md: "auto" }}>
            <VStack align={{ base: "center", md: "start" }} spacing={0}>
              <Text color="gray.800" fontWeight="bold" fontSize={{ base: "md", md: "xl" }}>
                我 ({playerName})
              </Text>
              <HStack spacing={{ base: 2, md: 3 }}>
                <HStack>
                  <Icon as={FaCoins} color="yellow.500" boxSize={{ base: 4, md: 5 }} />
                  <Text color="yellow.600" fontSize={{ base: "sm", md: "lg" }} fontWeight="bold">
                    {me?.money ?? 0} 金币
                  </Text>
                </HStack>
                <Badge colorScheme="blue" fontSize={{ base: "xs", md: "sm" }}>
                  {me?.score ?? 0} 分
                </Badge>
              </HStack>
            </VStack>

            <Box w="full" bg="gray.50" p={{ base: 1.5, md: 3 }} borderRadius="xl" borderWidth={1} borderColor="gray.100">
              <Text color="gray.500" fontSize={{ base: "2xs", md: "xs" }} mb={{ base: 1, md: 2 }}>
                我的投资(已打出)
              </Text>
              <HStack spacing={{ base: 2, md: 4 }} pb={2} overflowX="auto">
                {COMPANIES.map((company) => {
                  const count = me?.investments?.[String(company)] ?? 0;
                  const hasToken = blockedCompanies.has(company);
                  return (
                    <VStack
                      key={company}
                      opacity={count > 0 ? 1 : 0.4}
                      position="relative"
                      wrap={"wrap"}
                    >
                      <CardItem company={company} size={investCardSize} />
                      {count > 0 && (
                        <Badge
                          position="absolute"
                          bottom="-1"
                          right="-1"
                          colorScheme="blackAlpha"
                          variant="solid"
                          borderRadius="full"
                          fontSize="2xs"
                        >
                          {count}
                        </Badge>
                      )}
                      {hasToken && (
                        <Box
                          position="absolute"
                          top="2"
                          right="2"
                          zIndex={1}
                          bg="white"
                          borderWidth={1}
                          borderRadius="full"
                          boxShadow="sm"
                          p={0.5}
                          display="flex"
                        >
                          <Icon as={FaGrinStars} color={COMPANY_COLORS[company]} boxSize={"1.2rem"} />
                        </Box>
                      )}
                    </VStack>
                  );
                })}
              </HStack>
            </Box>
          </VStack>

          {/* 我的手牌(手机端点选卡牌操作) */}
          <VStack spacing={1}>
            <Text color="gray.500" fontSize="sm" fontWeight="bold">
              我的手牌
            </Text>
            {canPlay && (
              <Text color="blue.400" fontSize="2xs">
                {view?.turn_phase === "play" || selectedHandIdx === null
                  ? "点击一张手牌选择操作"
                  : "点击\"持股\"或\"上架\""}
              </Text>
            )}
            <HStack spacing={{ base: handSpacingBase, md: "-12" }}>
              {(me?.hand ?? []).map((companyId, idx) => {
                const playAllowed = canPlay;
                const justTaken = view?.took_from_market_company === companyId;
                const marketAllowed =
                  playAllowed && !blockedCompanies.has(companyId) && !justTaken;
                const marketBlockReason = blockedCompanies.has(companyId)
                  ? "你持有该公司反垄断标记,不能上架"
                  : justTaken
                    ? "刚从市场拿回的卡牌,本回合不能再上架,可持股或打其他牌"
                    : "";
                const isSelected = selectedHandIdx === idx;
                return (
                  <Box
                    key={`${companyId}-${idx}`}
                    overflow="hidden"
                    cursor="pointer"
                    transition="all 0.3s"
                    onClick={() => setSelectedHandIdx(isSelected ? null : idx)}
                    _hover={{
                      transform: isSelected
                        ? "translateY(-24px)"
                        : "translateY(-20px)",
                      zIndex: 10,
                      boxShadow: "2xl",
                    }}
                    position="relative"
                    zIndex={isSelected ? 20 : idx}
                    transformOrigin="bottom center"
                    style={{
                      transform: isSelected
                        ? `rotate(0deg) translateY(-24px)`
                        : `rotate(${(idx - 1) * 5}deg) translateY(${Math.abs(idx - 1) * 5}px)`,
                    }}
                  >
                    <CardItem company={companyId} size={handCardSize} />
                    {/* 点选/悬停显示的操作层 */}
                    <Flex
                      position="absolute"
                      inset={0}
                      bg={isSelected ? "blackAlpha.500" : "transparent"}
                      borderRadius="lg"
                      opacity={isSelected ? 1 : 0}
                      _hover={{ opacity: 1 }}
                      direction="column"
                      justify="center"
                      align="center"
                      gap={2}
                      transition="opacity 0.2s"
                    >
                      <Button
                        size="sm"
                        colorScheme="green"
                        w="24"
                        shadow="md"
                        isDisabled={!playAllowed}
                        onClick={(e) => {
                          e.stopPropagation();
                          act(() => playCard(roomId, playerName, companyId, "invest"), "投资");
                        }}
                      >
                        持股
                      </Button>
                      <Tooltip
                        label={marketBlockReason}
                        isDisabled={marketAllowed}
                        hasArrow
                      >
                        <Button
                          size="sm"
                          colorScheme="orange"
                          w="24"
                          shadow="md"
                          isDisabled={!marketAllowed}
                          onClick={(e) => {
                            e.stopPropagation();
                            act(() => playCard(roomId, playerName, companyId, "to_market"), "上架");
                          }}
                        >
                          上架
                        </Button>
                      </Tooltip>
                    </Flex>
                  </Box>
                );
              })}
            </HStack>
          </VStack>
          <Box flex={1} display={{ base: "none", md: "block" }} /> {/* 占位符 */}
        </Flex>
      </Flex>

      {/* 回合结算弹窗 */}
      <Modal isOpen={!!roundSummary} onClose={() => setRoundSummary(null)} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>第 {roundSummary?.round_number} 轮结算</ModalHeader>
          <ModalBody>
            <VStack align="stretch" spacing={2}>
              {roundSummary?.standings.map((s) => (
                <Flex key={s.player_id} justify="space-between" bg="gray.50" p={2} borderRadius="md">
                  <Text fontWeight="bold">
                    第{s.rank}名 {s.player_id}
                  </Text>
                  <HStack>
                    <Text color="yellow.600">{s.money} 元</Text>
                    <Badge colorScheme={s.score_delta! > 0 ? "green" : s.score_delta! < 0 ? "red" : "gray"}>
                      {s.score_delta! > 0 ? `+${s.score_delta}` : s.score_delta} 分
                    </Badge>
                  </HStack>
                </Flex>
              ))}
              {roundSummary &&
                Object.entries(roundSummary.payouts).map(([company, info]) => {
                  const total = Object.values(info.paid).reduce((a, b) => a + b, 0);
                  return (
                    <Text key={company} fontSize="xs" color="gray.500">
                      公司 {company}:最大股东 {info.major} 收取 {total} 元
                    </Text>
                  );
                })}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="blue" onClick={() => setRoundSummary(null)}>
              继续游戏
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 游戏结束弹窗 */}
      <Modal isOpen={!!gameOver} onClose={() => {}} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>游戏结束 🎉</ModalHeader>
          <ModalBody>
            <Text mb={4} fontWeight="bold" color="blue.600" fontSize="lg" textAlign="center">
              胜者:{gameOver?.winner}
            </Text>
            <VStack align="stretch" spacing={2}>
              {gameOver?.standings.map((s) => (
                <Flex key={s.player_id} justify="space-between" bg="gray.50" p={2} borderRadius="md">
                  <Text fontWeight="bold">
                    第{s.rank}名 {s.player_id}
                  </Text>
                  <HStack>
                    <Text color="blue.600">{s.score} 分</Text>
                    <Text color="yellow.600" fontSize="sm">
                      {s.money} 元
                    </Text>
                  </HStack>
                </Flex>
              ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              onClick={() => {
                disconnect();
                navigate("/");
              }}
            >
              回到大厅
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default GamePage;
