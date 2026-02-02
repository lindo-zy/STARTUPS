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
  Image,
  Tooltip,
  SimpleGrid,
  IconButton,
} from "@chakra-ui/react";
import { InvestmentGrid } from "./components/InvestmentGrid";
import { COMPANY_COLORS } from "../../constants/game";

// --- 模拟数据类型与辅助函数 ---
const COMPANIES = [5, 6, 7, 8, 9, 10];

const getCardImage = (company: number) => `/img/p${company}.jpg`;

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
  const { socket, isConnected, connect, disconnect } = useSocket();
  const toast = useToast();

  const roomId = location.state?.room_id || searchParams.get("room_id");

  useEffect(() => {
    if (!roomId) {
      navigate("/");
      return;
    }
    const playerId = localStorage.getItem("playerId");
    if (playerId) {
      connect(roomId, playerId);
    }
    return () => disconnect();
  }, [roomId, navigate]);

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
    investments: { 8: 1, 9: 2 },
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

  // --- 子组件 ---

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
          <Button size="xs" colorScheme="red">
            退出游戏
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
              bg={player.isActive ? "white" : "transparent"}
              p={2}
              borderRadius="md"
              borderWidth={player.isActive ? 1 : 0}
              borderColor={player.isActive ? "yellow.400" : "transparent"}
              boxShadow={player.isActive ? "lg" : "none"}
              spacing={2}
              minW="120px"
            >
              {/* 不显示头像，仅显示信息 */}
              <VStack spacing={0} align="center">
                <Text color="gray.700" fontSize="sm" fontWeight="bold">
                  {player.name}
                </Text>
                <HStack spacing={2}>
                  <Text fontSize="xs" color="yellow.600" fontWeight="bold">
                    💰{player.coins}
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
                _hover={{ transform: "translateY(-5px)" }}
                transition="all 0.2s"
              >
                <Center h="full">
                  <Text color="whiteAlpha.800" fontWeight="bold" fontSize="2xl">
                    DECK
                  </Text>
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
              <Button size="sm" colorScheme="blue" variant="outline">
                抽牌 (-1💰)
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
                <Text color="gray.400">市场空空如也</Text>
              )}
              {market.map((card) => (
                <VStack key={card.id} position="relative">
                  <Tooltip label={`点击拿取 (获得 ${card.coins} 金币)`}>
                    <Box
                      w="24"
                      h="36"
                      borderRadius="lg"
                      overflow="hidden"
                      boxShadow="md"
                      cursor="pointer"
                      _hover={{ transform: "scale(1.05)", boxShadow: "xl" }}
                      transition="all 0.2s"
                      position="relative"
                    >
                      <Image
                        src={getCardImage(card.company)}
                        alt={`Company ${card.company}`}
                        w="full"
                        h="full"
                        objectFit="cover"
                      />
                      {/* 卡牌上的金币 */}
                      {card.coins > 0 && (
                        <Flex
                          position="absolute"
                          inset={0}
                          bg="blackAlpha.600"
                          align="center"
                          justify="center"
                        >
                          <VStack spacing={-1}>
                            <Text fontSize="2xl">💰</Text>
                            <Text
                              color="yellow.300"
                              fontWeight="bold"
                              fontSize="lg"
                            >
                              {card.coins}
                            </Text>
                          </VStack>
                        </Flex>
                      )}
                    </Box>
                  </Tooltip>
                  {/* 公司徽章 */}
                  <Badge
                    bg={COMPANY_COLORS[card.company]}
                    color="white"
                    boxShadow="sm"
                  >
                    {card.company}
                  </Badge>
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
              <Text color="yellow.600" fontSize="lg" fontWeight="bold">
                💰 {me.coins} 金币
              </Text>
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
                    >
                      <Box
                        w="16"
                        h="24"
                        position="relative"
                        boxShadow="sm"
                        borderRadius="md"
                      >
                        <Image
                          src={getCardImage(company)}
                          w="full"
                          h="full"
                          objectFit="cover"
                          borderRadius="md"
                          filter={
                            count === 0
                              ? "grayscale(100%) opacity(0.7)"
                              : "none"
                          }
                        />
                        <Center
                          position="absolute"
                          inset={0}
                          bg={count > 0 ? "blackAlpha.400" : "transparent"}
                          borderRadius="md"
                        >
                          {count > 0 && (
                            <Text
                              color="white"
                              fontWeight="bold"
                              fontSize="xl"
                              textShadow="0 1px 2px rgba(0,0,0,0.5)"
                            >
                              {count}
                            </Text>
                          )}
                        </Center>
                      </Box>
                      {hasToken && (
                        <Badge
                          colorScheme="purple"
                          position="absolute"
                          top="-2"
                          right="-2"
                          fontSize="0.7em"
                          boxShadow="sm"
                        >
                          🛡️ 垄断
                        </Badge>
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
                  w="32"
                  h="48"
                  borderRadius="xl"
                  boxShadow="xl"
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
                  <Image
                    src={getCardImage(companyId)}
                    w="full"
                    h="full"
                    objectFit="cover"
                  />
                  {/* 悬停显示的操作层 */}
                  <Flex
                    position="absolute"
                    inset={0}
                    bg="whiteAlpha.900"
                    opacity={0}
                    _hover={{ opacity: 1 }}
                    direction="column"
                    justify="center"
                    align="center"
                    gap={2}
                    transition="opacity 0.2s"
                  >
                    <Button size="sm" colorScheme="green" w="24" shadow="md">
                      持股
                    </Button>
                    <Button size="sm" colorScheme="orange" w="24" shadow="md">
                      丢弃
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
