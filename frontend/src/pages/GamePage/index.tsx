import React, { useEffect } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useSocket } from "../../context/SocketContext";
import {
  Box,
  Flex,
  Text,
  Button,
  Badge,
  useToast,
  VStack,
  HStack,
  Center,
  Tooltip,
  Icon,
} from "@chakra-ui/react";
import { FaCoins, FaSignOutAlt, FaBoxOpen, FaGrinStars } from "react-icons/fa";
import { GiCardDraw } from "react-icons/gi";
import { InvestmentGrid } from "./components/InvestmentGrid";
import { COMPANY_COLORS, COMPANIES } from "../../constants/game";
import CardItem from "./components/CardItem";
import {
  deleteRoom,
  drawFromDeck,
  leaveRoom,
  playCard,
  startGame,
  takeFromMarket,
} from "../../services/api";

interface Player {
  id: string;
  name: string;
  coins: number;
  handCount: number;
  investments: Record<number, number>; // 公司ID -> 持股数量
  antitrustTokens: number[]; // 玩家拥有反垄断标记的公司列表
  isActive: boolean;
}

interface MarketCard {
  id: string;
  company: number;
  coins: number;
}

const GamePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isConnected, connect, disconnect, socket } = useSocket();
  const toast = useToast();

  const roomId = location.state?.room_id || searchParams.get("room_id");
  const type = location.state?.type || searchParams.get("type");
  const playerName = location.state?.player_id || searchParams.get("player_name");

  const [isWaiting, setIsWaiting] = React.useState(true);
  const [joinedPlayers, setJoinedPlayers] = React.useState<Player[]>([
    {
      id: "p1",
      name: "我",
      coins: 10,
      handCount: 3,
      investments: {},
      antitrustTokens: [],
      isActive: false,
    },
  ]);

  // 模拟好友加入（仅演示用，实际应通过 socket 监听）
  useEffect(() => {
    if (isWaiting) {
      const timer = setTimeout(() => {
        setJoinedPlayers((prev) => [
          ...prev,
          {
            id: "p2",
            name: "好友 A",
            coins: 10,
            handCount: 3,
            investments: {},
            antitrustTokens: [],
            isActive: false,
          },
        ]);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isWaiting]);

  // 监听 socket 消息更新玩家列表
  useEffect(() => {
    if (socket && isWaiting) {
      const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "player_joined") {
            // 假设后端返回的是新加入的玩家信息或完整玩家列表
            // 这里仅作示例，具体需根据后端协议调整
            // setJoinedPlayers(data.players);
          }
        } catch (error) {
          console.error("解析消息失败:", error);
        }
      };

      socket.addEventListener("message", handleMessage);
      return () => {
        socket.removeEventListener("message", handleMessage);
      };
    }
  }, [socket, isWaiting]);

  const handleStartGame = async () => {
    if (joinedPlayers.length < 2) {
      toast({
        title: "玩家不足",
        description: "至少需要 2 人加入游戏",
        status: "warning",
        duration: 3000,
        isClosable: true,
        position: "top",
      });
      return;
    }
    const res = await startGame({
      room_id: roomId,
      host_player_name: playerName,
    });
    if (res) {
      setIsWaiting(false);
      toast({
        title: "游戏开始",
        description: "祝你好运！",
        status: "success",
        duration: 3000,
        isClosable: true,
        position: "top",
      });
    }
    // TODO: 发送开始游戏指令
    // if (socket && isConnected) {
    //   socket.send(JSON.stringify({ action: "start_game", room_id: roomId }));
    // }
  };

  useEffect(() => {
    if (!roomId) {
      navigate("/");
      return;
    }
    // 连接逻辑在真实后端集成时开启
    const playerId = localStorage.getItem("playerId");
    if (!playerId) {
      navigate("/");
      return;
    }
    // connect(roomId, playerId);
    return () => disconnect();
  }, [roomId]);

  useEffect(() => {
    if (isConnected) {
      toast({
        title: "连接成功",
        status: "success",
        duration: 2000,
        position: "top",
      });
    }
  }, [isConnected, toast]);

  // --- 模拟状态 ---
  // 在实际应用中，这部分数据来自 socket onmessage
  const opponents: Player[] = Array(5)
    .fill(null)
    .map((_, i) => ({
      id: `p${i + 2}`,
      name: `玩家 ${i + 2}`,
      coins: 10,
      handCount: 3,
      investments: { 5: i === 0 ? 2 : 0, 10: i === 1 ? 3 : 0 },
      antitrustTokens: i === 0 ? [5] : i === 1 ? [10] : [],
      isActive: i === 0,
    }));

  const me: Player = {
    id: "p1",
    name: "我",
    coins: 10,
    handCount: 3,
    investments: { 5: 1, 6: 1, 7: 1, 8: 1, 9: 2, 10: 1 },
    antitrustTokens: [9],
    isActive: false,
  };

  const market: MarketCard[] = [
    { id: "m1", company: 6, coins: 1 },
    { id: "m2", company: 8, coins: 0 },
    { id: "m3", company: 6, coins: 3 },
  ];

  const myHand = [5, 6, 10]; // 手牌中的公司ID

  const deckCount = 38;

  if (isWaiting) {
    return (
      <Box
        minH="100vh"
        bg="gray.50"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <VStack
          spacing={8}
          p={10}
          bg="white"
          borderRadius="2xl"
          boxShadow="2xl"
          minW="400px"
          textAlign="center"
        >
          <VStack spacing={2}>
            <Text fontSize="2xl" fontWeight="bold" color="gray.700">
              等待游戏开启
            </Text>
            <Text color="gray.500">等待好友加入房间...</Text>
          </VStack>

          <Box
            p={6}
            bg="blue.50"
            borderRadius="xl"
            borderWidth={1}
            borderColor="blue.100"
            w="full"
          >
            <Text color="blue.600" fontSize="sm" fontWeight="bold" mb={1}>
              房间号
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
            <Text
              fontSize="md"
              fontWeight="bold"
              color="gray.600"
              mb={3}
              textAlign="left"
            >
              已加入玩家 ({joinedPlayers.length}/7)
            </Text>
            <VStack spacing={3} align="stretch">
              {joinedPlayers.map((player) => (
                <Flex
                  key={player.id}
                  bg="gray.50"
                  p={3}
                  borderRadius="lg"
                  align="center"
                  justify="space-between"
                  borderWidth={1}
                  borderColor="gray.200"
                >
                  <HStack spacing={3}>
                    <Icon as={FaGrinStars} color="blue.400" />
                    <Text fontWeight="medium" color="gray.700">
                      {player.name}
                      {/* p1更换为 host_player_id */}
                      {player.id === "p1" && type === "create" && (
                        <Badge ml={2} colorScheme="green" variant="subtle">
                          房主
                        </Badge>
                      )}
                    </Text>
                  </HStack>
                </Flex>
              ))}
              {/* 占位符展示空位 */}
              {Array.from({ length: 6 - joinedPlayers.length }).map((_, i) => (
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
              ))}
            </VStack>
          </Box>

          {type === "create" && (
            <VStack w="full" spacing={4}>
              <Button
                size="lg"
                colorScheme="blue"
                w="full"
                height="3.5rem"
                fontSize="lg"
                onClick={handleStartGame}
                boxShadow="lg"
                _hover={{ transform: "translateY(-2px)", boxShadow: "xl" }}
                transition="all 0.2s"
              >
                开始游戏
              </Button>

              <Button
                variant="ghost"
                colorScheme="red"
                size="sm"
                onClick={async () => {
                  navigate("/");
                  await deleteRoom(roomId);
                }}
              >
                取消并退出
              </Button>
            </VStack>
          )}
        </VStack>
      </Box>
    );
  }

  return (
    <Box
      minH="100vh"
      bg="gray.50"
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      {/* 1. 顶部栏 */}
      <Flex
        bg="white"
        p={2}
        justify="space-between"
        align="center"
        boxShadow="sm"
      >
        <HStack>
          <Text color="gray.800" fontWeight="bold">
            Room: {roomId}
          </Text>
          <Badge colorScheme={isConnected ? "green" : "red"}>
            {isConnected ? "ONLINE" : "OFFLINE"}
          </Badge>
        </HStack>
        <Link to="/">
          <Button
            size="xs"
            colorScheme="red"
            leftIcon={<Icon as={FaSignOutAlt} />}
            onClick={async () => {
              await leaveRoom(roomId);
              navigate("/");
            }}
          >
            退出
          </Button>
        </Link>
      </Flex>

      {/* 2. 游戏主区域 */}
      <Flex flex={1} position="relative" p={4} direction="column">
        {/* 对手区域 (顶部弧形) */}
        <Flex justify="center" gap={6} mb={8} wrap="wrap">
          {opponents.map((player) => (
            <VStack
              key={player.id}
              bg="white"
              p={5}
              borderRadius="md"
              borderWidth={player.isActive ? 2 : 0}
              borderColor={player.isActive ? "yellow.400" : "white"}
              boxShadow={player.isActive ? "lg" : "none"}
              spacing={2}
              minW="120px"
            >
              <VStack spacing={0} align="center">
                <Text color="gray.700" fontSize="sm" fontWeight="bold">
                  {player.name}
                </Text>
                <HStack spacing={1} align="center">
                  <Icon as={FaCoins} color="yellow.500" boxSize={3} />
                  <Text fontSize="xs" color="yellow.600" fontWeight="bold">
                    {player.coins}
                  </Text>
                </HStack>
              </VStack>
              {/* 对手投资情况 */}
              <InvestmentGrid
                investments={player.investments}
                tokens={player.antitrustTokens}
              />
            </VStack>
          ))}
        </Flex>

        {/* 中央桌面 (市场 & 牌堆) */}
        <Flex
          flex={1}
          justify="center"
          align="center"
          direction="column"
          gap={8}
        >
          <HStack spacing={12} align="center">
            {/* 牌堆 */}
            <VStack>
              <Box
                w="28"
                h="40"
                bg="blue.700"
                borderRadius="lg"
                borderWidth={4}
                borderColor="white"
                boxShadow="xl"
                position="relative"
                cursor="pointer"
                // _hover={{ transform: "translateY(-5px)" }}
                transition="all 0.2s"
              >
                <Center h="full">
                  <Icon as={GiCardDraw} boxSize={16} color="whiteAlpha.800" />
                </Center>
                <Badge
                  position="absolute"
                  top="-3"
                  right="-3"
                  bg="red.500"
                  color="white"
                  fontSize="lg"
                  borderRadius="full"
                  w={8}
                  h={8}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  boxShadow="md"
                >
                  {deckCount}
                </Badge>
              </Box>
              <Button
                size="sm"
                colorScheme="blue"
                variant="outline"
                onClick={async () => {
                  await drawFromDeck({ room_id: roomId, player_id: me.id });
                }}
              >
                抽牌 (-1 <Icon as={FaCoins} ml={1} />)
              </Button>
            </VStack>

            {/* 市场 */}
            <HStack
              p={6}
              bg="white"
              borderRadius="3xl"
              boxShadow="lg"
              borderWidth={1}
              borderColor="gray.200"
              borderStyle="solid"
              minW="400px"
              minH="200px"
              justify="center"
              wrap="wrap"
              gap={4}
            >
              {market.length === 0 && (
                <VStack spacing={1}>
                  <Icon as={FaBoxOpen} boxSize={8} color="gray.300" />
                  <Text color="gray.400" fontSize="sm">
                    市场空空如也
                  </Text>
                </VStack>
              )}
              {market.map((card, index) => (
                <VStack key={card.id} position="relative">
                  <Tooltip label={`点击拿取 (获得 ${card.coins} 金币)`}>
                    <Box
                      cursor="pointer"
                      _hover={{ transform: "scale(1.05)", boxShadow: "xl" }}
                      transition="all 0.2s"
                      position="relative"
                      onClick={async () => {
                        await takeFromMarket({
                          room_id: roomId,
                          player_id: me.id,
                          card_index: index,
                        });
                      }}
                    >
                      <CardItem company={card.company} size={10} />
                      {card.coins > 0 && (
                        <Badge
                          position="absolute"
                          height="2.5rem"
                          width="2.5rem"
                          top="-2"
                          right="-2"
                          bg="yellow.400"
                          fontSize="large"
                          borderRadius="full"
                          p={5}
                          boxShadow="md"
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          gap={1}
                          fontWeight="bold"
                          fontFamily="Fredoka"
                        >
                          {card.coins}
                        </Badge>
                      )}
                    </Box>
                  </Tooltip>
                </VStack>
              ))}
            </HStack>
          </HStack>
        </Flex>

        {/* 3. 玩家区域 (底部) */}
        <Flex
          mt="auto"
          bg="white"
          borderTopRadius="3xl"
          p={6}
          gap={8}
          align="end"
          justify="center"
          boxShadow="0 -4px 20px rgba(0,0,0,0.05)"
        >
          {/* 我的状态与投资 */}
          <VStack align="start" spacing={4} flex={1}>
            <VStack align="start" spacing={0}>
              <Text color="gray.800" fontWeight="bold" fontSize="xl">
                我 ({me.name})
              </Text>
              <HStack>
                <Icon as={FaCoins} color="yellow.500" boxSize={5} />
                <Text color="yellow.600" fontSize="lg" fontWeight="bold">
                  {me.coins} 金币
                </Text>
              </HStack>
            </VStack>

            <Box
              w="full"
              bg="gray.50"
              p={3}
              borderRadius="xl"
              borderWidth={1}
              borderColor="gray.100"
            >
              <Text color="gray.500" fontSize="xs" mb={2}>
                我的投资 (已打出)
              </Text>
              <HStack spacing={4} overflowX="auto">
                {COMPANIES.map((company) => {
                  const count = me.investments[company] || 0;
                  const hasToken = me.antitrustTokens.includes(company);
                  return (
                    <VStack
                      key={company}
                      opacity={count > 0 ? 1 : 0.4}
                      position="relative"
                      wrap={"wrap"}
                    >
                      <CardItem company={company} size={8} />
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
                          <Icon
                            as={FaGrinStars}
                            color={COMPANY_COLORS[company]}
                            boxSize={"2rem"}
                          />
                        </Box>
                      )}
                    </VStack>
                  );
                })}
              </HStack>
            </Box>
          </VStack>
          {/* 我的手牌 */}
          <VStack spacing={2}>
            <Text color="gray.500" fontSize="sm" fontWeight="bold">
              我的手牌
            </Text>
            <HStack spacing={-12}>
              {myHand.map((companyId, idx) => (
                <Box
                  key={idx}
                  overflow="hidden"
                  cursor="pointer"
                  transition="all 0.3s"
                  _hover={{
                    transform: "translateY(-40px)",
                    zIndex: 10,
                    boxShadow: "2xl",
                  }}
                  position="relative"
                  zIndex={idx}
                  transformOrigin="bottom center"
                  style={{
                    transform: `rotate(${(idx - 1) * 5}deg) translateY(${Math.abs(idx - 1) * 5}px)`,
                  }}
                >
                  <CardItem company={companyId} size={12} />
                  {/* 悬停显示的操作层 */}
                  <Flex
                    position="absolute"
                    inset={0}
                    // bg="whiteAlpha.900"
                    opacity={0}
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
                      onClick={async () => {
                        await playCard({
                          room_id: roomId,
                          player_id: me.id,
                          card_company: companyId.toString(),
                          action: "invest",
                        });
                      }}
                    >
                      持股
                    </Button>
                    <Button
                      size="sm"
                      colorScheme="orange"
                      w="24"
                      shadow="md"
                      onClick={async () => {
                        await playCard({
                          room_id: roomId,
                          player_id: me.id,
                          card_company: companyId.toString(),
                          action: "to_market",
                        });
                      }}
                    >
                      上架
                    </Button>
                  </Flex>
                </Box>
              ))}
            </HStack>
          </VStack>
          <Box flex={1} /> {/* 占位符 */}
        </Flex>
      </Flex>
    </Box>
  );
};

export default GamePage;
