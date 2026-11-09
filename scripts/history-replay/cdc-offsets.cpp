// Content-defined boundaries keep unchanged regions reusable across Unity builds.
#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>
int main(int argc,char**argv){
 if(argc!=2)return 2;std::ifstream file(argv[1],std::ios::binary);if(!file)return 3;
 std::vector<unsigned char> data((std::istreambuf_iterator<char>(file)),{});
 uint64_t table[256],seed=0x9e3779b97f4a7c15ull;
 for(auto &v:table){seed^=seed<<13;seed^=seed>>7;seed^=seed<<17;v=seed;}
 size_t start=0;uint64_t rolling=0;
 for(size_t i=0;i<data.size();++i){rolling=(rolling<<1)+table[data[i]];size_t size=i+1-start;
  if(size>=65536&&((rolling&262143)==0||size>=1048576)){std::cout<<i+1<<'\n';start=i+1;rolling=0;}}
 if(start<data.size())std::cout<<data.size()<<'\n';
}
