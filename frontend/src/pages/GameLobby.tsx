import React from "react";

import {
  Box,
  Button,
  Input,
  Heading,
  VStack,
  HStack,
  Center,
  useColorModeValue,
  Text,
} from "@chakra-ui/react";

const GameLobby: React.FC = () => {
  const bgColor = useColorModeValue("gray.50", "gray.900");
  const cardBg = useColorModeValue("white", "gray.800");
  const textColor = useColorModeValue("gray.800", "white");

  return (
    <Box minH="100vh" p={4} bg={bgColor} w="full">
      <Center h="100vh">
        <Box
          bg={cardBg}
          borderRadius="xl"
          shadow="2xl"
          p={8}
          maxW="md"
          w="full"
          borderWidth="1px"
          borderColor={useColorModeValue("gray.200", "gray.700")}
          backdropFilter="auto"
          backdropBlur="10px"
          position="relative"
          overflow="hidden"
        >
          {/* 装饰元素 */}
          <Box
            position="absolute"
            top="-48px"
            right="-48px"
            w="160px"
            h="160px"
            bg="blue.500"
            borderRadius="full"
            opacity={0.1}
          />
          <Box
            position="absolute"
            bottom="-48px"
            left="-48px"
            w="160px"
            h="160px"
            bg="purple.500"
            borderRadius="full"
            opacity={0.1}
          />

          <Box position="relative" zIndex={10}>
            <Heading
              as="h1"
              size="2xl"
              textAlign="center"
              mb={8}
              fontWeight="bold"
              color={textColor}
            >
              游戏大厅
            </Heading>

            <VStack spacing={6} align="stretch">
              {/* 创建房间按钮 */}
              <Box>
                <Button
                  colorScheme="blue"
                  size="lg"
                  w="full"
                  py={6}
                  fontSize="lg"
                  borderRadius="md"
                  _hover={{
                    bg: "blue.600",
                    transform: "scale(1.02)",
                  }}
                  _active={{ bg: "blue.700" }}
                  _focus={{ boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.5)" }}
                  transition="all 0.3s ease"
                >
                  创建房间
                </Button>
              </Box>

              {/* 加入房间区域 */}
              <Box>
                <HStack spacing={3}>
                  <Input
                    placeholder="输入房间ID"
                    variant="outline"
                    size="lg"
                    focusBorderColor="blue.500"
                    borderRadius="md"
                    flex="1"
                    _focus={{ boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.3)" }}
                    bg={useColorModeValue("white", "gray.700")}
                    borderColor={useColorModeValue("gray.200", "gray.600")}
                  />
                  <Button
                    colorScheme="green"
                    size="lg"
                    py={6}
                    borderRadius="md"
                    _hover={{
                      bg: "green.600",
                      transform: "scale(1.05)",
                    }}
                    _active={{ bg: "green.700" }}
                    _focus={{ boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.5)" }}
                    transition="all 0.3s ease"
                  >
                    加入
                  </Button>
                </HStack>
              </Box>

              {/* 测试游戏页面链接 */}
              {/*  <Box mt={8} textAlign="center">
                <Button
                  as={Link}
                  to="/game"
                  variant="link"
                  colorScheme="blue"
                  fontSize="md"
                  rightIcon={<ArrowRightIcon />}
                  _hover={{ textDecoration: "underline", color: "blue.700" }}
                  transition="all 0.3s ease"
                >
                  进入测试游戏页面
                </Button>
              </Box> */}
            </VStack>
          </Box>
        </Box>
      </Center>

      {/* 页脚 */}
      <Box mt={8} textAlign="center">
        <Text fontSize="sm" color="gray.500">
          © 2026 游戏平台 | 享受游戏时光
        </Text>
      </Box>
    </Box>
  );
};

export default GameLobby;
