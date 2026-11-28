// Test-only inspector, using the pinned GPLv3 nifly library. No writes.
#include <NifFile.hpp>
#include <iostream>
#include <exception>
int main(int argc, char** argv) {
 if (argc != 2) return 2;
 try {
  nifly::NifFile nif;
  if (nif.Load(argv[1]) != 0 || !nif.IsValid()) return 3;
  const auto shapes=nif.GetShapes();
  size_t vertices=0, triangles=0;
  for (auto* shape:shapes) {
   vertices+=shape->GetNumVertices();
   triangles+=shape->GetNumTriangles();
  }
  const auto& version=nif.GetHeader().GetVersion();
  std::cout << "{\"stream\":" << version.Stream()
   << ",\"user\":" << version.User()
   << ",\"shapes\":" << shapes.size()
   << ",\"vertices\":" << vertices
   << ",\"triangles\":" << triangles
   << ",\"unknownBlocks\":" << (nif.HasUnknown()?"true":"false") << "}";
  return 0;
 } catch (const std::exception& e) { std::cerr << "Parser exception"; return 4; }
}
